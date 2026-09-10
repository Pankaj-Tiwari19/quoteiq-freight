// OpenAI-compatible chat/completions provider (Gemini free tier, Groq, Ollama, OpenAI...). Uses fetch only.
import fs from "fs";
import path from "path";
import type { LlmClient, LlmConfig, LlmContent, LlmTool, ToolCallRecord } from "./index";

/** Gemini's OpenAI-compatible endpoint accepts an OpenAPI subset: no union `type` arrays and no null in enums.
 *  Convert `type: ["number","null"]` -> `type: "number", nullable: true` without touching the canonical schema. */
function sanitizeSchema(s: any): any {
  if (Array.isArray(s)) return s.map(sanitizeSchema);
  if (!s || typeof s !== "object") return s;
  const out: any = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === "type" && Array.isArray(v)) { const t = v.filter(x => x !== "null"); out.type = t.length === 1 ? t[0] : t; if (v.includes("null")) out.nullable = true; }
    else if (k === "enum" && Array.isArray(v)) { out.enum = v.filter(x => x !== null); if (v.includes(null)) out.nullable = true; }
    else out[k] = sanitizeSchema(v);
  }
  return out;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [2000, 5000, 10000];

const toParts = (c: LlmContent[]) => c.map(b => b.type === "text" ? { type: "text", text: b.text } : { type: "image_url", image_url: { url: `data:${b.media_type};base64,${b.base64}` } });
const toTools = (tools: LlmTool[]) => tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: sanitizeSchema(t.input_schema) } }));

export function openAiCompatClient(cfg: LlmConfig): LlmClient {
  const url = cfg.baseUrl!.replace(/\/$/, "") + "/chat/completions";
  const debugDir = process.env.LLM_DEBUG ? path.join(process.cwd(), "data", "llm_debug") : null;
  async function chat(body: any, tag = "chat") {
    const payload = JSON.stringify({ model: cfg.model, ...body });
    let res!: Response, raw = "";
    for (let attempt = 0; ; attempt++) {
      res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` }, body: payload });
      raw = await res.text();
      // Transient capacity errors (Gemini "high demand" 503, rate-limit 429): back off and retry. Never retry 4xx client errors.
      if (!(RETRYABLE.has(res.status) && attempt < RETRY_DELAYS_MS.length)) break;
      console.warn(`${cfg.provider} API ${res.status} on ${tag}; retrying in ${RETRY_DELAYS_MS[attempt] / 1000}s (${attempt + 1}/${RETRY_DELAYS_MS.length})`);
      await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
    if (debugDir) { fs.mkdirSync(debugDir, { recursive: true }); fs.writeFileSync(path.join(debugDir, `${Date.now()}_${tag}.json`), JSON.stringify({ request: { ...body, messages: "(omitted)" }, status: res.status, response: raw }, null, 2)); }
    if (!res.ok) throw new Error(`${cfg.provider} API ${res.status}: ${raw.slice(0, 500)}`);
    const j = JSON.parse(raw); const choice = j.choices?.[0]; const msg = choice?.message;
    if (!msg) throw new Error(`Empty completion. finish_reason=${choice?.finish_reason ?? "n/a"} raw=${raw.slice(0, 400)}`);
    return { ...(msg as { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }), finish_reason: choice.finish_reason as string | undefined };
  }
  /** Pull the first balanced JSON object out of free text (handles prose + ```json fences). */
  function jsonFromText(t: string | null): any | null {
    if (!t) return null;
    const s = t.replace(/```(?:json)?/g, ""); const a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a < 0 || b <= a) return null;
    try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
  }
  const parseArgs = (a: string) => JSON.parse(a || "{}");
  return {
    provider: cfg.provider, model: cfg.model,
    async extractStructured({ system, content, schema, toolName, toolDescription, maxTokens }) {
      const messages = [{ role: "system", content: system }, { role: "user", content: toParts(content) }];
      // Reasoning models spend output tokens on thinking before the function call; give them headroom.
      const max_tokens = Math.max(maxTokens, 16000);
      const diag: string[] = [];
      // 1. Forced function call (works on Anthropic-compatible and most OpenAI-compatible servers).
      const m1 = await chat({ max_tokens, messages, tools: toTools([{ name: toolName, description: toolDescription, input_schema: schema }]), tool_choice: { type: "function", function: { name: toolName } } }, "extract_fn");
      const tc = m1.tool_calls?.[0];
      if (tc) { try { return parseArgs(tc.function.arguments); } catch (e: any) { diag.push(`function args not JSON (${e.message}); finish_reason=${m1.finish_reason}`); } }
      else { const j = jsonFromText(m1.content); if (j) return j; diag.push(`no tool_call; finish_reason=${m1.finish_reason}; content=${(m1.content ?? "").slice(0, 200)}`); }
      // 2. Gemini drops large function calls (MALFORMED_FUNCTION_CALL) or truncates; JSON-schema response mode is more reliable for big outputs.
      try {
        const m2 = await chat({ max_tokens, messages, response_format: { type: "json_schema", json_schema: { name: toolName, schema: sanitizeSchema(schema) } } }, "extract_schema");
        const j = jsonFromText(m2.content); if (j) return j; diag.push(`json_schema mode: finish_reason=${m2.finish_reason}; content=${(m2.content ?? "").slice(0, 200)}`);
      } catch (e: any) { diag.push(`json_schema mode rejected: ${e.message.slice(0, 200)}`); }
      // 3. Plain JSON mode with the schema in the prompt (widest compatibility).
      const m3 = await chat({ max_tokens, response_format: { type: "json_object" }, messages: [{ role: "system", content: `${system}\n\nRespond with ONLY a JSON object matching this JSON Schema:\n${JSON.stringify(sanitizeSchema(schema))}` }, messages[1]] }, "extract_json");
      const j3 = jsonFromText(m3.content); if (j3) return j3;
      diag.push(`json_object mode: finish_reason=${m3.finish_reason}; content=${(m3.content ?? "").slice(0, 200)}`);
      throw new Error(`Model returned no structured output after 3 attempts. ${diag.join(" | ")}${debugDir ? "" : " (set LLM_DEBUG=1 to dump raw responses to data/llm_debug/)"}`);
    },
    async chatWithTools({ system, history, question, tools, runTool, maxIterations, maxTokens }) {
      const messages: any[] = [{ role: "system", content: system }, ...history, { role: "user", content: question }];
      const calls: ToolCallRecord[] = [];
      for (let i = 0; i < maxIterations; i++) {
        const msg = await chat({ max_tokens: Math.max(maxTokens, 8000), messages, tools: toTools(tools) }, "analyst");
        if (!msg.tool_calls?.length) return { answer: (msg.content ?? "") || `(no answer; finish_reason=${msg.finish_reason})`, tool_calls: calls };
        messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });
        for (const tc of msg.tool_calls) {
          const input = parseArgs(tc.function.arguments); const out = runTool(tc.function.name, input);
          calls.push({ name: tc.function.name, input, rows: Array.isArray(out) ? out.length : 1 });
          messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(out) });
        }
      }
      return { answer: "I could not finish answering within the tool-call budget.", tool_calls: calls };
    },
    async complete({ system, prompt, maxTokens }) {
      const msg = await chat({ max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] });
      return msg.content ?? "";
    },
  };
}
