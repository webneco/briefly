// Text helpers. The important one is findQuote: it decides whether words a model says it copied
// from a page are really on that page.

interface Token {
  word: string;
  start: number;
  end: number;
}

const WORD = /[\p{L}\p{N}]+/gu;

function fold(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .toLowerCase();
}

/** Words with their positions in the original string. Apostrophes inside a word are dropped. */
function tokens(s: string): Token[] {
  const out: Token[] = [];
  const folded = fold(s).replace(/(\p{L})'(\p{L})/gu, '$1\u0000$2');
  for (const m of folded.matchAll(WORD)) {
    out.push({ word: m[0], start: m.index, end: m.index + m[0].length });
  }
  // Join the halves of words that were split around an apostrophe ("company's" -> "companys").
  const joined: Token[] = [];
  for (const t of out) {
    const prev = joined[joined.length - 1];
    if (prev && folded[prev.end] === '\u0000' && t.start === prev.end + 1) {
      prev.word += t.word;
      prev.end = t.end;
    } else {
      joined.push({ ...t });
    }
  }
  return joined;
}

export function words(s: string): string[] {
  return tokens(s).map((t) => t.word);
}

export function wordCount(s: string): number {
  return tokens(s).length;
}

export interface QuoteMatch {
  found: boolean;
  /** 1 for a word-for-word match; lower for a near match. */
  score: number;
  /** Where the match starts and ends in the page text. -1 when not found. */
  start: number;
  end: number;
}

const MISS: QuoteMatch = { found: false, score: 0, start: -1, end: -1 };

/** A quote shorter than this proves too little to count as evidence. */
export const MIN_QUOTE_WORDS = 5;
const NEAR_MATCH = 0.8;
const GRAM = 4;

/**
 * Looks for a quote in a page. Case, punctuation, quote marks and markdown are ignored, because
 * models normalise those when they copy. A word-for-word match scores 1. Otherwise the quote
 * counts as found when at least 80% of its four-word runs appear close together on the page,
 * which tolerates a dropped word or a trimmed clause but not a paraphrase.
 */
export function findQuote(quote: string, text: string): QuoteMatch {
  const q = tokens(quote);
  if (q.length < MIN_QUOTE_WORDS) return MISS;
  const t = tokens(text);
  if (t.length < q.length - 2) return MISS;

  // Word-for-word.
  const first = q[0]!.word;
  for (let i = 0; i + q.length <= t.length; i++) {
    if (t[i]!.word !== first) continue;
    let k = 1;
    while (k < q.length && t[i + k]!.word === q[k]!.word) k++;
    if (k === q.length) return { found: true, score: 1, start: t[i]!.start, end: t[i + k - 1]!.end };
  }

  // Near match: slide a window a little longer than the quote and count shared four-word runs.
  const grams = new Set<string>();
  for (let i = 0; i + GRAM <= q.length; i++) grams.add(gram(q, i));
  if (grams.size === 0) return MISS;
  const span = Math.ceil(q.length * 1.3) + 2;
  const at: number[] = [];
  for (let i = 0; i + GRAM <= t.length; i++) if (grams.has(gram(t, i))) at.push(i);
  let best = 0;
  let bestStart = -1;
  let bestEnd = -1;
  let lo = 0;
  for (let hi = 0; hi < at.length; hi++) {
    while (at[hi]! - at[lo]! > span) lo++;
    const seen = new Set<string>();
    for (let k = lo; k <= hi; k++) seen.add(gram(t, at[k]!));
    if (seen.size > best) {
      best = seen.size;
      bestStart = at[lo]!;
      bestEnd = Math.min(t.length - 1, at[hi]! + GRAM - 1);
    }
  }
  const score = best / grams.size;
  if (score >= NEAR_MATCH && bestStart >= 0) {
    return { found: true, score, start: t[bestStart]!.start, end: t[bestEnd]!.end };
  }
  return { ...MISS, score };
}

function gram(t: Token[], i: number): string {
  let s = t[i]!.word;
  for (let k = 1; k < GRAM; k++) s += ' ' + t[i + k]!.word;
  return s;
}

/** The text around a match, widened to sentence boundaries, for showing where a claim comes from. */
export function excerpt(text: string, start: number, end: number, context: number): string {
  let a = Math.max(0, start - context);
  let b = Math.min(text.length, end + context);
  // Widen to the nearest sentence or line boundary so the passage does not start mid-word.
  const before = text.slice(a, start);
  const cut = Math.max(before.lastIndexOf('. '), before.lastIndexOf('\n'));
  if (cut >= 0) a += cut + 1;
  const after = text.slice(end, b);
  const stop = after.search(/[.!?](\s|$)/);
  if (stop >= 0) b = end + stop + 1;
  const out = clean(text.slice(a, b));
  return (a > 0 ? '… ' : '') + out + (b < text.length ? ' …' : '');
}

/**
 * Page text as a reader sees it: links become their labels, images and bare URLs go, line breaks
 * stay. Done once when a page is read, so drafting, quote matching and the evidence shown to the
 * reader all work on the same text.
 */
export function plain(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, '$1')
    .replace(/<https?:\/\/[^>\s]+>/g, ' ')
    .replace(/https?:\/\/[^\s)\]]+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Strips markdown noise and collapses whitespace, for showing page text to a reader. */
export function clean(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_`>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the text names any of the given names, as whole words. */
export function mentions(text: string, names: string[]): boolean {
  const hay = ' ' + words(text).join(' ') + ' ';
  for (const name of names) {
    const needle = words(name).join(' ');
    if (needle.length >= 2 && hay.includes(' ' + needle + ' ')) return true;
  }
  return false;
}

export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.5 ? cut.slice(0, space) : cut).trimEnd() + " …";
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/** The same article under two URLs (tracking parameters, a trailing slash) should count once. */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref$|ref_|source$|mc_|cmp|ocid)/i.test(key)) u.searchParams.delete(key);
    }
    const path = u.pathname.replace(/\/+$/, '');
    const query = u.searchParams.toString();
    return `${u.hostname.replace(/^www\./, '').toLowerCase()}${path}${query ? '?' + query : ''}`;
  } catch {
    return url;
  }
}

/** Two headlines are about the same story when most of their distinctive words overlap. */
export function similar(a: string, b: string): number {
  const stop = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'for', 'on', 'and', 'with', 'at', 'by', 'as', 'is', 'its', 'from']);
  const wa = new Set(words(a).filter((w) => !stop.has(w)));
  const wb = new Set(words(b).filter((w) => !stop.has(w)));
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size);
}
