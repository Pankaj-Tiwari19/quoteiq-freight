// Native Gemini provider via @google/genai. Extraction uses JSON-schema structured output (the path validated on
// Vendor B); the analyst loop uses function calling; memos use plain generateContent. Nothing here computes.
import { GoogleGenAI, type Content, type Part } from "@google/genai";
import type { LlmClient, LlmConfig, LlmContent, ToolCallRecord } from "./index";

/** Gemini's responseJsonSchema is safest with a single `type` per node; convert `type: [X, 'null']` unions to anyOf. */
export function sanitizeSchema(schema: any): any {
  const walk = (node: any): any => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const n: any = {}; for (const k of Object.keys(node)) n[k] = walk(node[k]);
    if (Array.isArray(n.type)) {
      const { type, ...rest } = n; const keep: any = {}; if (rest.description) keep.description = rest.description;
      return { ...keep, anyOf: (type as string[]).map(t => { const b: any = { type: t }; if (t === "array" && rest.items) b.items = rest.items; if (t === "object" && rest.properties) { b.properties = rest.properties; if (rest.required) b.required = rest.required; } if (t === "string" && rest.enum) b.enum = rest.enum.filter((e: any) => e != null); if (rest.enum && t !== "string") b.enum = rest.enum.filter((e: any) => e != null); return b; }) };
    }
    if (Array.isArray(n.enum) && n.enum.includes(null)) { n.enum = n.enum.filter((e: any) => e != null); }
    return n;
  };
  return walk(schema);
}

const toParts = (c: LlmContent[]): Part[] => c.map(b => b.type === "text" ? { text: b.text } : { inlineData: { mimeType: b.media_type, data: b.base64 } });
const statusOf = (e: any): number | undefined => { const s = e?.status ?? e?.code ?? e?.error?.code; if (typeof s === "number") return s; const m = String(e?.message ?? "").match(/\b(4\d\d|5\d\d)\b/); return m ? Number(m[1]) : undefined; };
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let last: any;
  for (let i = 1; i <= 3; i++) { try { return await fn(); } catch (e) { last = e; const s = statusOf(e); if (!s || !RETRYABLE.has(s) || i === 3) throw e; await new Promise(r => setTimeout(r, 2000 * 2 ** (i - 1))); } }
  throw last;
}

export function geminiClient(cfg: LlmConfig): LlmClient {
  const ai = new GoogleGenAI({ apiKey: cfg.apiKey });
  return {
    provider: "gemini", model: cfg.model,
    async extractStructured({ system, content, schema, toolName, toolDescription, maxTokens }) {
      const res = await withRetry(() => ai.models.generateContent({ model: cfg.model, contents: [{ role: "user", parts: toParts(content) }],
        config: { systemInstruction: `${system}\n\nRespond with a single JSON object named "${toolName}": ${toolDescription}`, responseMimeType: "application/json", responseJsonSchema: sanitizeSchema(schema), maxOutputTokens: maxTokens } }));
      const finish = String(res.candidates?.[0]?.finishReason ?? "");
      if (finish === "MAX_TOKENS") throw new Error("Output truncated at maxOutputTokens; structured output incomplete.");
      const text = res.text ?? "";
      try { return JSON.parse(text); } catch { throw new Error(`Gemini returned no parseable JSON (finishReason=${finish || "none"}, ${text.length} chars).`); }
    },
    async chatWithTools({ system, history, question, tools, runTool, maxIterations, maxTokens }) {
      const contents: Content[] = [...history.map(h => ({ role: h.role === "assistant" ? "model" : "user", parts: [{ text: h.content }] })), { role: "user", parts: [{ text: question }] }];
      const calls: ToolCallRecord[] = [];
      const functionDeclarations = tools.map(t => ({ name: t.name, description: t.description, parametersJsonSchema: sanitizeSchema(t.input_schema) }));
      for (let i = 0; i < maxIterations; i++) {
        const res = await withRetry(() => ai.models.generateContent({ model: cfg.model, contents, config: { systemInstruction: system, tools: [{ functionDeclarations }], maxOutputTokens: maxTokens } }));
        const modelContent = res.candidates?.[0]?.content;
        const fcs = res.functionCalls ?? [];
        if (!fcs.length || !modelContent) return { answer: res.text ?? "", tool_calls: calls };
        contents.push(modelContent);                                   // echoed verbatim so Gemini 3 thought signatures survive the round trip
        contents.push({ role: "user", parts: fcs.map(fc => { const out = runTool(fc.name ?? "", fc.args ?? {}); calls.push({ name: fc.name ?? "", input: fc.args, rows: Array.isArray(out) ? out.length : 1 }); return { functionResponse: { name: fc.name ?? "", id: fc.id, response: { result: out } } }; }) });
      }
      return { answer: "I could not finish answering within the tool-call budget.", tool_calls: calls };
    },
    async complete({ system, prompt, maxTokens }) {
      const res = await withRetry(() => ai.models.generateContent({ model: cfg.model, contents: [{ role: "user", parts: [{ text: prompt }] }], config: { systemInstruction: system, maxOutputTokens: maxTokens } }));
      return res.text ?? "";
    },
  };
}
