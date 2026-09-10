// Provider abstraction. Everything model-specific lives in ./gemini.ts (default) or ./anthropic.ts.
// The rest of the app only sees this interface.

export type LlmContent =
  | { type: "text"; text: string }
  | { type: "image"; media_type: "image/jpeg" | "image/png" | "application/pdf"; base64: string };   // PDFs go inline as a document part too

export interface LlmTool { name: string; description: string; input_schema: any; }
export interface ToolCallRecord { name: string; input: any; rows: number; }

export interface LlmClient {
  provider: string;
  model: string;
  /** Force the model to return one object matching `schema` (via tool/function calling). */
  extractStructured(opts: { system: string; content: LlmContent[]; schema: any; toolName: string; toolDescription: string; maxTokens: number }): Promise<any>;
  /** Tool-calling loop: model asks for tools, app runs them, until the model answers in text. */
  chatWithTools(opts: { system: string; history: { role: "user" | "assistant"; content: string }[]; question: string; tools: LlmTool[]; runTool: (name: string, input: any) => any; maxIterations: number; maxTokens: number }): Promise<{ answer: string; tool_calls: ToolCallRecord[] }>;
  /** Plain text completion. */
  complete(opts: { system: string; prompt: string; maxTokens: number }): Promise<string>;
}

export interface LlmConfig { provider: string; apiKey: string | undefined; model: string; baseUrl: string | undefined; }

const PRESETS: Record<string, { baseUrl?: string; model: string; keyEnv: string[] }> = {
  anthropic: { model: "claude-sonnet-4-6", keyEnv: ["LLM_API_KEY", "ANTHROPIC_API_KEY"] },
  gemini: { model: "gemini-3.8-flash", keyEnv: ["LLM_API_KEY", "GEMINI_API_KEY", "VITE_GEMINI_API_KEY"] },
};

export function getLlmConfig(): LlmConfig {
  const provider = (process.env.LLM_PROVIDER || "gemini").toLowerCase();
  const preset = PRESETS[provider];
  if (!preset) throw new Error(`Unknown LLM_PROVIDER "${provider}". Use gemini or anthropic.`);
  const apiKey = preset.keyEnv.map(k => process.env[k]).find(Boolean);
  return { provider, apiKey, model: process.env.LLM_MODEL || process.env.QUOTEIQ_MODEL || preset.model, baseUrl: process.env.LLM_BASE_URL || preset.baseUrl };
}

/** Human-readable reason the LLM is not usable, or null if it is. Used by API routes. */
export function llmUnavailableReason(): string | null {
  try {
    const c = getLlmConfig();
    if (!c.apiKey) return `No API key for LLM_PROVIDER=${c.provider}. Copy .env.example to .env.local, set LLM_API_KEY, and restart.`;
    return null;
  } catch (e: any) { return e.message; }
}

export async function getLlm(): Promise<LlmClient> {
  const c = getLlmConfig();
  const why = llmUnavailableReason(); if (why) throw new Error(why);
  if (c.provider === "anthropic") return (await import("./anthropic")).anthropicClient(c);
  return (await import("./gemini")).geminiClient(c);
}
