// Stand-ins for the outside world, so Briefly can run with no keys:
//   FixtureResearch answers searches from a folder of articles instead of Tavily.
//   TapedModel replays model replies recorded from a real run, and records new ones when a
//   real model is attached.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inWindow, toDay } from './dates.ts';
import { words } from './text.ts';
import type { ChatResult, Extracted, Model, RawResult, Research, SearchParams } from './types.ts';

export interface Article {
  url: string;
  title: string;
  /** Any date format, or null for a page with no date. */
  published: string | null;
  text: string;
  /** Set to make Extract fail for this page, as real pages sometimes do. */
  unreadable?: boolean;
}

const NOISE = new Set(['or', 'and', 'the', 'a', 'of', 'to', 'in', 'for', 'company', 'official', 'website', 'announcement', 'current', 'role', 'profile']);

export class FixtureResearch implements Research {
  readonly name = 'a set of made-up fixture articles';
  readonly articles: Article[];

  constructor(dir: string) {
    this.articles = readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Article);
  }

  async search(p: SearchParams): Promise<{ results: RawResult[]; credits: number }> {
    const terms = [...new Set(words(p.query).filter((w) => !NOISE.has(w)))];
    const results: RawResult[] = [];
    for (const a of this.articles) {
      const day = toDay(a.published);
      // Like Tavily's filter_by_published_date: a news search in a window drops undated pages.
      if (p.window && p.topic === 'news' && !inWindow(day, p.window)) continue;
      const body = new Set(words(`${a.title} ${a.text}`));
      const matched = terms.filter((t) => body.has(t)).length;
      if (matched === 0) continue;
      const preferred = p.preferDomains?.some((d) => a.url.includes(d)) ? 0.2 : 0;
      results.push({
        url: a.url,
        title: a.title,
        content: a.text.replace(/\s+/g, ' ').slice(0, 300),
        score: Math.min(0.99, matched / terms.length + preferred),
        publishedDate: a.published,
      });
    }
    // Best match first; among equals, the newest, as a news search would.
    results.sort((x, y) => y.score - x.score || (toDay(y.publishedDate) ?? '').localeCompare(toDay(x.publishedDate) ?? ''));
    return { results: results.slice(0, p.maxResults), credits: 1 };
  }

  async extract(urls: string[], _about: string): Promise<{ pages: Extracted[]; failed: string[]; credits: number }> {
    const pages: Extracted[] = [];
    const failed: string[] = [];
    for (const url of urls) {
      const a = this.articles.find((x) => x.url === url);
      if (a && !a.unreadable) pages.push({ url, text: a.text });
      else failed.push(url);
    }
    return { pages, failed, credits: Math.ceil(pages.length / 5) };
  }
}

interface TapeEntry {
  task: string;
  value: unknown;
  tokensIn: number;
  tokensOut: number;
}

export class TapedModel implements Model {
  readonly name: string;
  private file: string;
  private inner: Model | null;
  private tape: Record<string, TapeEntry>;

  /** With a real model attached, missing replies are fetched and written to the tape. */
  constructor(file: string, inner: Model | null, recordedName?: string) {
    this.file = file;
    this.inner = inner;
    const saved = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { model?: string; replies?: Record<string, TapeEntry> }) : {};
    this.tape = saved.replies ?? {};
    this.name = inner?.name ?? saved.model ?? recordedName ?? 'recorded model';
  }

  async json<T>(task: string, system: string, user: string): Promise<ChatResult<T>> {
    const key = createHash('sha256').update(system).update('\n').update(user).digest('hex').slice(0, 24);
    const hit = this.tape[key];
    if (hit) return { value: hit.value as T, tokensIn: hit.tokensIn, tokensOut: hit.tokensOut };
    if (!this.inner) {
      throw new Error(`The recorded demo has no reply for the "${task}" step. The fixtures or prompts changed since it was recorded; record it again with a model key.`);
    }
    const r = await this.inner.json<T>(task, system, user);
    this.tape[key] = { task, value: r.value, tokensIn: r.tokensIn, tokensOut: r.tokensOut };
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify({ model: this.inner.name, replies: this.tape }, null, 1) + '\n');
    return r;
  }
}
