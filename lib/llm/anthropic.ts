import Anthropic from "@anthropic-ai/sdk";
import type { LlmClient, LlmConfig, LlmContent, ToolCallRecord } from "./index";

const toBlocks = (c: LlmContent[]): Anthropic.ContentBlockParam[] => c.map(b => b.type === "text" ? { type: "text", text: b.text } : b.media_type === "application/pdf" ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b.base64 } } as Anthropic.ContentBlockParam) : { type: "image", source: { type: "base64", media_type: b.media_type, data: b.base64 } });

export function anthropicClient(cfg: LlmConfig): LlmClient {
  const client = new Anthropic({ apiKey: cfg.apiKey });
  return {
    provider: "anthropic", model: cfg.model,
    async extractStructured({ system, content, schema, toolName, toolDescription, maxTokens }) {
      const res = await client.messages.create({ model: cfg.model, max_tokens: maxTokens, system,
        tools: [{ name: toolName, description: toolDescription, input_schema: schema }], tool_choice: { type: "tool", name: toolName },
        messages: [{ role: "user", content: toBlocks(content) }] });
      const tool = res.content.find(b => b.type === "tool_use");
      if (!tool || tool.type !== "tool_use") throw new Error("Model returned no structured output");
      return tool.input;
    },
    async chatWithTools({ system, history, question, tools, runTool, maxIterations, maxTokens }) {
      const messages: Anthropic.MessageParam[] = [...history.map(h => ({ role: h.role, content: h.content })), { role: "user", content: question }];
      const calls: ToolCallRecord[] = [];
      for (let i = 0; i < maxIterations; i++) {
        const res = await client.messages.create({ model: cfg.model, max_tokens: maxTokens, system, messages,
          tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema })) });
        const uses = res.content.filter(b => b.type === "tool_use");
        if (!uses.length || res.stop_reason === "end_turn") return { answer: res.content.filter(b => b.type === "text").map(b => (b as any).text).join("\n"), tool_calls: calls };
        messages.push({ role: "assistant", content: res.content });
        messages.push({ role: "user", content: uses.map(u => { if (u.type !== "tool_use") throw new Error(); const out = runTool(u.name, u.input); calls.push({ name: u.name, input: u.input, rows: Array.isArray(out) ? out.length : 1 }); return { type: "tool_result" as const, tool_use_id: u.id, content: JSON.stringify(out) }; }) });
      }
      return { answer: "I could not finish answering within the tool-call budget.", tool_calls: calls };
    },
    async complete({ system, prompt, maxTokens }) {
      const res = await client.messages.create({ model: cfg.model, max_tokens: maxTokens, system, messages: [{ role: "user", content: prompt }] });
      return res.content.filter(b => b.type === "text").map(b => (b as any).text).join("\n");
    },
  };
}
