import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface Settings {
  tavilyKey: string;
  llmBaseUrl: string;
  llmKey: string;
  llmModel: string;
  /** Optional quicker model for the two set-up steps. Empty means use llmModel for everything. */
  llmFastModel: string;
  /** Claude only: "low", "medium", "high", "xhigh" or "max". Empty leaves the model's default. */
  llmEffort: string;
  port: number;
  cache: boolean;
}

/** Reads KEY=value lines from .env into process.env, without overriding what is already set. */
export function loadDotEnv(dir = process.cwd()): void {
  const file = resolve(dir, '.env');
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function settings(): Settings {
  loadDotEnv();
  const env = process.env;
  return {
    tavilyKey: env.TAVILY_API_KEY ?? '',
    llmBaseUrl: (env.LLM_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, ''),
    llmKey: env.LLM_API_KEY ?? env.OPENAI_API_KEY ?? '',
    llmModel: env.LLM_MODEL ?? 'gpt-4o-mini',
    llmFastModel: env.LLM_FAST_MODEL ?? '',
    llmEffort: env.LLM_EFFORT ?? '',
    port: Number(env.PORT ?? 8787),
    cache: env.BRIEFLY_CACHE === '1',
  };
}

/** Names the settings that are missing, so the error tells the user exactly what to add. */
export function missing(s: Settings): string[] {
  const out: string[] = [];
  if (!s.tavilyKey) out.push('TAVILY_API_KEY');
  if (!s.llmKey) out.push('LLM_API_KEY');
  return out;
}
