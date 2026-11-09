// A small client for any OpenAI-compatible chat completions endpoint: OpenAI, Gemini, Groq,
// or a gateway such as Bifrost. Every call asks for JSON and parses it.

import type { ChatResult, Model } from './types.ts';

export interface ChatOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Sent as x-bf-session-id, so a gateway such as Bifrost can group one brief's calls. */
  sessionId?: string;
  /** For Claude models: how much the model thinks before answering ("low" to "max"). Empty leaves the model's default. */
  effort?: string;
  fetch?: typeof fetch;
}

export class ModelError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ModelError';
    this.status = status;
  }
}

export class ChatModel implements Model {
  readonly name: string;
  private opts: ChatOptions;
  private fetch: typeof fetch;
  // Some models reject these fields. Drop one after the first rejection and keep it dropped.
  private sendTemperature = true;
  private sendJsonMode = true;

  constructor(opts: ChatOptions) {
    this.opts = opts;
    this.name = opts.model;
    this.fetch = opts.fetch ?? fetch;
  }

  async json<T>(task: string, system: string, user: string): Promise<ChatResult<T>> {
    let tokensIn = 0;
    let tokensOut = 0;
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * attempt));
      const body: Record<string, unknown> = {
        model: this.opts.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      };
      if (this.sendTemperature) body.temperature = 0.1;
      if (this.sendJsonMode) body.response_format = { type: 'json_object' };
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        authorization: `Bearer ${this.opts.apiKey}`,
      };
      if (this.opts.sessionId) headers['x-bf-session-id'] = this.opts.sessionId;

      let res: Response;
      try {
        res = await this.fetch(`${this.opts.baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120_000),
        });
      } catch (err) {
        lastError = new ModelError(0, `The model endpoint could not be reached (${task}): ${(err as Error).message}`);
        continue;
      }
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 400);
        if (res.status === 400 && this.sendTemperature && /temperature/i.test(detail)) {
          this.sendTemperature = false;
          continue;
        }
        if (res.status === 400 && this.sendJsonMode && /response_format|json_object|json mode/i.test(detail)) {
          this.sendJsonMode = false;
          continue;
        }
        lastError = new ModelError(res.status, `The model answered ${res.status} (${task}): ${detail || 'no detail given'}`);
        if (res.status === 429 || res.status >= 500) continue;
        break;
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      tokensIn += data.usage?.prompt_tokens ?? 0;
      tokensOut += data.usage?.completion_tokens ?? 0;
      const text = data.choices?.[0]?.message?.content ?? '';
      const value = parseJson<T>(text);
      if (value !== undefined) return { value, tokensIn, tokensOut };
      lastError = new ModelError(0, `The model did not return JSON (${task}).`);
    }
    throw lastError ?? new ModelError(0, `The model call failed (${task}).`);
  }
}

/** The same contract over Anthropic's Messages API, for a Claude key used directly. */
export class AnthropicModel implements Model {
  readonly name: string;
  private opts: ChatOptions;
  private fetch: typeof fetch;
  private sendEffort: boolean;

  constructor(opts: ChatOptions) {
    this.opts = opts;
    this.name = opts.model;
    this.fetch = opts.fetch ?? fetch;
    this.sendEffort = Boolean(opts.effort);
  }

  async json<T>(task: string, system: string, user: string): Promise<ChatResult<T>> {
    let tokensIn = 0;
    let tokensOut = 0;
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 700 * attempt));
      const body: Record<string, unknown> = {
        model: this.opts.model,
        // Current Claude models think before they answer, and thinking counts toward this limit,
        // so it has to leave room for both.
        max_tokens: 32_000,
        system,
        messages: [{ role: 'user', content: user }],
      };
      if (this.sendEffort) body.output_config = { effort: this.opts.effort };
      let res: Response;
      try {
        res = await this.fetch(`${this.opts.baseUrl}/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': this.opts.apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(300_000),
        });
      } catch (err) {
        lastError = new ModelError(0, `The model endpoint could not be reached (${task}): ${(err as Error).message}`);
        continue;
      }
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 400);
        if (res.status === 400 && this.sendEffort && /effort|output_config/i.test(detail)) {
          this.sendEffort = false;
          continue;
        }
        lastError = new ModelError(res.status, `The model answered ${res.status} (${task}): ${detail || 'no detail given'}`);
        if (res.status === 429 || res.status >= 500) continue;
        break;
      }
      const data = (await res.json()) as {
        content?: { type?: string; text?: string }[];
        usage?: { input_tokens?: number; output_tokens?: number };
        stop_reason?: string;
      };
      tokensIn += data.usage?.input_tokens ?? 0;
      tokensOut += data.usage?.output_tokens ?? 0;
      const text = (data.content ?? [])
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('');
      const value = parseJson<T>(text);
      if (value !== undefined) return { value, tokensIn, tokensOut };
      if (process.env.BRIEFLY_DEBUG) {
        process.stderr.write(`\n[${task}] stop_reason=${data.stop_reason} blocks=${(data.content ?? []).map((c) => c.type).join(',')} out=${data.usage?.output_tokens}\n${text.slice(0, 1500)}\n...\n${text.slice(-600)}\n`);
      }
      lastError = new ModelError(
        0,
        data.stop_reason === 'max_tokens'
          ? `The model ran out of room before it finished (${task}). Set LLM_EFFORT=medium or low.`
          : `The model did not return JSON (${task}).`,
      );
      // Asking again with the same budget would only run out again.
      if (data.stop_reason === 'max_tokens') break;
    }
    throw lastError ?? new ModelError(0, `The model call failed (${task}).`);
  }
}

/** Picks the client from the endpoint: Anthropic's own API, or anything OpenAI-compatible. */
export function makeModel(opts: ChatOptions): Model {
  return /(^|\.)anthropic\.com/.test(new URL(opts.baseUrl).hostname) ? new AnthropicModel(opts) : new ChatModel(opts);
}

/** Parses a JSON object out of a model reply, tolerating code fences and stray text around it. */
export function parseJson<T>(text: string): T | undefined {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    /* fall through */
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as T;
    } catch {
      /* fall through */
    }
  }
  return undefined;
}
