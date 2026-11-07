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
  fallbacks?: string[]; // tried in order if the model 404s or stays overloaded
}

export const PROVIDERS: Record<string, Provider> = {
  meta: {
    name: "meta",
    baseURL: process.env.META_API_BASE ?? "https://api.meta.ai/v1",
    apiKeyEnv: "MODEL_API_KEY",
    model: process.env.META_MODEL ?? "muse-spark-1.2",
    fallbacks: (process.env.META_FALLBACKS ?? "muse-spark-1.3,muse-spark-1.1").split(",").filter(Boolean),
  },
  gemini: {
    name: "gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKeyEnv: "GEMINI_API_KEY",
    model: process.env.GEMINI_MODEL ?? "gemini-4-argon",
  },
  "gemini-flash": {
    name: "gemini-flash",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKeyEnv: "GEMINI_API_KEY",
    model: "gemini-3.8-flash",
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
  fallbackCalls = 0;
  errors = 0;

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
    if (opts.reasoningEffort) body.reasoning_effort = opts.reasoningEffort === "minimal" ? "low" : opts.reasoningEffort;

    const models = [this.provider.model, ...(this.provider.fallbacks ?? [])];
    let lastErr: unknown;
    for (const model of models) {
      body.model = model;
      for (let attempt = 0; attempt < 4; attempt++) {
        let res: Response;
        try {
          res = await fetch(`${this.provider.baseURL}/chat/completions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
        } catch (e) {
          lastErr = e;
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        if (res.ok) {
          const data: any = await res.json();
          this.calls++;
          if (model !== this.provider.model) this.fallbackCalls++;
          if (data.usage) {
            this.usage.prompt_tokens += data.usage.prompt_tokens ?? 0;
            this.usage.completion_tokens += data.usage.completion_tokens ?? 0;
          }
          const m = data.choices?.[0]?.message;
          return { role: "assistant", content: m?.content ?? null, tool_calls: m?.tool_calls };
        }
        const text = await res.text();
        lastErr = new Error(`${this.provider.name}/${model} ${res.status}: ${text.slice(0, 400)}`);
        if (res.status === 429 || res.status >= 500) { await sleep(1000 * 2 ** attempt); continue; }
        if (res.status === 404 && attempt < 2) { await sleep(1500 * (attempt + 1)); continue; } // seen transiently on Meta
        if (res.status === 404) break; // try the next model
        throw lastErr; // 400/401/402/403: not retryable
      }
    }
    this.errors++;
    throw lastErr;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function parseJSON<T>(text: string | null): T {
  if (!text) throw new Error("empty model response");
  const cleaned = text.replace(/^```(?:json)?\s*/m, "").replace(/```\s*$/m, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}
