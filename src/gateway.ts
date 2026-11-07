// Provider-neutral model gateway. Every provider here speaks the OpenAI-compatible
// /chat/completions shape, so swapping models is config, not code.
// Default route: Meta Model API (Muse Spark).

export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface Message {
  role: Role;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface Provider {
  name: string;
  baseURL: string;
  apiKeyEnv: string;
  model: string;
}

export const PROVIDERS: Record<string, Provider> = {
  meta: {
    name: "meta",
    baseURL: process.env.META_API_BASE ?? "https://api.meta.ai/v1",
    apiKeyEnv: "MODEL_API_KEY",
    model: process.env.META_MODEL ?? "muse-spark-1.2",
  },
  gemini: {
    name: "gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKeyEnv: "GEMINI_API_KEY",
    model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
  },
  openrouter: {
    name: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    model: process.env.OPENROUTER_MODEL ?? "meta-llama/llama-4-maverick",
  },
};

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
}

export class Gateway {
  readonly provider: Provider;
  usage: Usage = { prompt_tokens: 0, completion_tokens: 0 };
  calls = 0;

  constructor(providerName = process.env.GATE_PROVIDER ?? "meta") {
    const p = PROVIDERS[providerName];
    if (!p) throw new Error(`Unknown provider "${providerName}". Known: ${Object.keys(PROVIDERS).join(", ")}`);
    this.provider = p;
  }

  static available(providerName = process.env.GATE_PROVIDER ?? "meta"): boolean {
    const p = PROVIDERS[providerName];
    return !!p && !!process.env[p.apiKeyEnv];
  }

  async chat(
    messages: Message[],
    opts: { tools?: ToolSpec[]; json?: boolean; maxTokens?: number; reasoningEffort?: "minimal" | "low" | "medium" | "high" } = {},
  ): Promise<Message> {
    const key = process.env[this.provider.apiKeyEnv];
    if (!key) throw new Error(`${this.provider.apiKeyEnv} is not set`);
    const body: Record<string, unknown> = {
      model: this.provider.model,
      messages,
      max_tokens: opts.maxTokens ?? 2048,
    };
    if (opts.tools?.length) body.tools = opts.tools;
    if (opts.json) body.response_format = { type: "json_object" };
    if (opts.reasoningEffort && this.provider.name === "meta") body.reasoning_effort = opts.reasoningEffort;

    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(`${this.provider.baseURL}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`${res.status} ${await res.text()}`);
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
          continue;
        }
        if (!res.ok) throw new Error(`${this.provider.name} ${res.status}: ${await res.text()}`);
        const data: any = await res.json();
        this.calls++;
        if (data.usage) {
          this.usage.prompt_tokens += data.usage.prompt_tokens ?? 0;
          this.usage.completion_tokens += data.usage.completion_tokens ?? 0;
        }
        const m = data.choices?.[0]?.message;
        return { role: "assistant", content: m?.content ?? null, tool_calls: m?.tool_calls };
      } catch (e) {
        lastErr = e;
        if (String(e).includes(" 4")) throw e;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
    throw lastErr;
  }
}

export function parseJSON<T>(text: string | null): T {
  if (!text) throw new Error("empty model response");
  const cleaned = text.replace(/^```(?:json)?\s*/m, "").replace(/```\s*$/m, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}
