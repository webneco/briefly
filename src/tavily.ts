// The Tavily client. Two calls matter to a brief: Search, limited to the 30-day window, and
// Extract, which fetches the page text that claims are checked against.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addDays } from './dates.ts';
import type { Extracted, RawResult, Research, SearchParams } from './types.ts';

const API = 'https://api.tavily.com';
const EXTRACT_BATCH = 20;

export interface TavilyOptions {
  apiKey: string;
  /** Sent as X-Session-Id so every call made for one brief is grouped in Tavily's logs. */
  sessionId?: string;
  /** Keep identical calls in .cache/ to save credits while developing. */
  cacheDir?: string;
  fetch?: typeof fetch;
}

export class TavilyError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'TavilyError';
    this.status = status;
  }
}

export class Tavily implements Research {
  readonly name = 'Tavily';
  private opts: TavilyOptions;
  private fetch: typeof fetch;

  constructor(opts: TavilyOptions) {
    this.opts = opts;
    this.fetch = opts.fetch ?? fetch;
  }

  async search(p: SearchParams): Promise<{ results: RawResult[]; credits: number }> {
    const body: Record<string, unknown> = {
      query: p.query,
      topic: p.topic,
      search_depth: 'basic',
      max_results: p.maxResults,
      include_published_date: true,
      include_usage: true,
    };
    if (p.window) {
      // Tavily describes these bounds as "after" and "before", so ask one day wider on each
      // side. The pipeline checks every result's date against the exact window afterwards.
      body.start_date = addDays(p.window.start, -1);
      body.end_date = addDays(p.window.end, 1);
      // Drop anything outside the window, and anything with no detectable date, at the source.
      if (p.topic === 'news') body.filter_by_published_date = true;
    }
    if (p.preferDomains?.length) {
      body.include_domains = p.preferDomains;
      body.include_domains_mode = 'prefer';
    }
    const data = (await this.post('/search', body)) as {
      results?: { url?: string; title?: string; content?: string; score?: number; published_date?: string | null }[];
      usage?: { credits?: number };
    };
    const results: RawResult[] = (data.results ?? [])
      .filter((r) => typeof r.url === 'string' && r.url)
      .map((r) => ({
        url: r.url as string,
        title: r.title ?? '',
        content: r.content ?? '',
        score: typeof r.score === 'number' ? r.score : 0,
        publishedDate: r.published_date ?? null,
      }));
    return { results, credits: data.usage?.credits ?? 1 };
  }

  async extract(urls: string[], _about: string): Promise<{ pages: Extracted[]; failed: string[]; credits: number }> {
    const pages: Extracted[] = [];
    const failed: string[] = [];
    let credits = 0;
    for (let i = 0; i < urls.length; i += EXTRACT_BATCH) {
      const batch = urls.slice(i, i + EXTRACT_BATCH);
      const data = (await this.post('/extract', {
        urls: batch,
        extract_depth: 'basic',
        format: 'markdown',
        include_usage: true,
      })) as {
        results?: { url?: string; raw_content?: string }[];
        failed_results?: { url?: string }[];
        usage?: { credits?: number };
      };
      let ok = 0;
      for (const r of data.results ?? []) {
        if (r.url && r.raw_content) {
          pages.push({ url: r.url, text: r.raw_content });
          ok++;
        }
      }
      for (const f of data.failed_results ?? []) if (f.url) failed.push(f.url);
      // Extract is billed per five successful pages. Tavily can report 0 on a new account.
      credits += data.usage?.credits || Math.ceil(ok / 5);
    }
    // A page that came back neither as a result nor as a failure still failed.
    const seen = new Set([...pages.map((p) => p.url), ...failed]);
    for (const u of urls) if (!seen.has(u)) failed.push(u);
    return { pages, failed, credits };
  }

  private async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    const cacheFile = this.opts.cacheDir
      ? join(this.opts.cacheDir, createHash('sha256').update(path + JSON.stringify(body)).digest('hex').slice(0, 32) + '.json')
      : null;
    if (cacheFile && existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, 'utf8'));

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${this.opts.apiKey}`,
    };
    if (this.opts.sessionId) headers['x-session-id'] = this.opts.sessionId;

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 600 * attempt));
      let res: Response;
      try {
        res = await this.fetch(API + path, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
      } catch (err) {
        lastError = new TavilyError(0, `Tavily ${path} could not be reached: ${(err as Error).message}`);
        continue;
      }
      if (res.ok) {
        const data = await res.json();
        if (cacheFile) {
          mkdirSync(this.opts.cacheDir as string, { recursive: true });
          writeFileSync(cacheFile, JSON.stringify(data));
        }
        return data;
      }
      const detail = await res.text().catch(() => '');
      lastError = new TavilyError(res.status, `Tavily ${path} answered ${res.status}: ${explain(res.status, detail)}`);
      // Only rate limits and server errors are worth trying again.
      if (res.status !== 429 && res.status < 500) break;
    }
    throw lastError ?? new TavilyError(0, `Tavily ${path} failed`);
  }
}

function explain(status: number, detail: string): string {
  if (status === 401) return 'the API key is missing or wrong. Check TAVILY_API_KEY.';
  if (status === 432 || status === 433) return 'the plan or pay-as-you-go limit was reached.';
  if (status === 429) return 'too many requests. Wait a moment and try again.';
  try {
    const d = JSON.parse(detail) as { detail?: { error?: string } | string };
    if (typeof d.detail === 'string') return d.detail;
    if (d.detail?.error) return d.detail.error;
  } catch {
    /* not JSON */
  }
  return detail.slice(0, 200) || 'no detail given.';
}
