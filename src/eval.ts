// Runs Briefly on a list of real subjects and reports what the checks did.
//   node src/eval.ts [eval/subjects.json]
// It spends Tavily credits and model tokens: about 10 credits and six model calls per subject.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { localToday } from './dates.ts';
import { makeBrief } from './pipeline.ts';
import { live, ROOT } from './run.ts';
import type { Brief, BriefRequest } from './types.ts';

interface Row {
  subject: string;
  kind: string;
  seconds: number;
  error?: string;
  searches?: number;
  pagesRead?: number;
  credits?: number;
  tally?: Brief['tally'];
  onPage?: { facts: number; unconfirmed: number; heldBack: number; words: number; sources: number };
  heldBackReasons?: string[];
  tokensIn?: number;
  tokensOut?: number;
  quiet?: boolean;
  /** Pages on which text aimed at AI readers was found: domain and how the text opens. */
  planted?: string[];
}

/** The reason text starts with a fixed phrase per check; group by it. */
function reasonKind(reason: string): string {
  if (/not found on the cited page/.test(reason)) return 'quote not on the page';
  if (/too short/.test(reason)) return 'quote too short';
  if (/outside the 30 days/.test(reason)) return 'outside the window';
  if (/does not name/.test(reason)) return 'page does not name the subject';
  if (/backs only part/.test(reason)) return 'source backs only part';
  if (/does not back/.test(reason)) return 'source does not back it';
  return 'second check did not run';
}

async function main(): Promise<void> {
  const file = process.argv[2] ?? join(ROOT, 'eval', 'subjects.json');
  const subjects = JSON.parse(readFileSync(file, 'utf8')) as Partial<BriefRequest>[];
  const today = localToday();
  const rows: Row[] = [];
  let model = '';
  for (const s of subjects) {
    const req: BriefRequest = { subject: String(s.subject), kind: s.kind === 'person' ? 'person' : 'company', meetingAt: today, purpose: s.purpose, hint: s.hint, now: today };
    const started = Date.now();
    process.stderr.write(`${req.subject} ... `);
    try {
      const { research, model: m, fast } = live();
      const b = await makeBrief(req, { research, model: m, fast });
      model = b.model;
      rows.push({
        subject: req.subject,
        kind: req.kind,
        seconds: Math.round((Date.now() - started) / 1000),
        searches: b.usage.searches,
        pagesRead: b.usage.pagesRead,
        credits: b.usage.tavilyCredits,
        tally: b.tally,
        onPage: { facts: b.developments.length + b.people.length, unconfirmed: b.reported.length, heldBack: b.unverified.length, words: b.words, sources: b.sources.length },
        heldBackReasons: b.unverified.map((c) => reasonKind(c.reason ?? '')),
        tokensIn: b.usage.llmTokensIn,
        tokensOut: b.usage.llmTokensOut,
        quiet: b.quiet,
        planted: b.planted.map((p) => `${b.sources.find((x) => x.id === p.sourceId)?.domain ?? 'a source'} (${p.foundBy}): ${p.excerpt}`),
      });
      process.stderr.write(`${b.tally.drafted} drafted, ${b.tally.facts} facts, ${b.tally.unconfirmed} unconfirmed, ${b.tally.heldBack} held back\n`);
    } catch (err) {
      rows.push({ subject: req.subject, kind: req.kind, seconds: Math.round((Date.now() - started) / 1000), error: (err as Error).message });
      process.stderr.write(`failed: ${(err as Error).message}\n`);
    }
  }

  const ok = rows.filter((r) => r.tally);
  const sum = (f: (r: Row) => number) => ok.reduce((n, r) => n + f(r), 0);
  const drafted = sum((r) => r.tally!.drafted);
  const reasons: Record<string, number> = {};
  for (const r of ok) for (const k of r.heldBackReasons ?? []) reasons[k] = (reasons[k] ?? 0) + 1;
  const lines = [
    `Run on ${today} with Tavily and ${model}. The window is the 30 days to that date.`,
    '',
    '| Subject | Searches | Pages read | Claims drafted | Verified facts | Unconfirmed reports | Held back | Seconds |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) =>
      r.tally
        ? `| ${r.subject} | ${r.searches} | ${r.pagesRead} | ${r.tally.drafted} | ${r.tally.facts} | ${r.tally.unconfirmed} | ${r.tally.heldBack} | ${r.seconds} |`
        : `| ${r.subject} | failed: ${r.error} | | | | | | ${r.seconds} |`,
    ),
    `| **Total** | ${sum((r) => r.searches!)} | ${sum((r) => r.pagesRead!)} | ${drafted} | ${sum((r) => r.tally!.facts)} | ${sum((r) => r.tally!.unconfirmed)} | ${sum((r) => r.tally!.heldBack)} | ${sum((r) => r.seconds)} |`,
    '',
    `${sum((r) => r.tally!.reworded)} of the claims that passed had first been narrowed by the checker to what the source states.`,
    Object.keys(reasons).length ? `Why claims were held back: ${Object.entries(reasons).map(([k, n]) => `${k} (${n})`).join(', ')}.` : 'No claim was held back.',
    `Text aimed at AI readers was found on ${sum((r) => r.planted?.length ?? 0)} of the ${sum((r) => r.pagesRead!)} pages read.`,
    `Tavily credits used: ${sum((r) => r.credits!)}. Model tokens: ${sum((r) => r.tokensIn!).toLocaleString('en')} in, ${sum((r) => r.tokensOut!).toLocaleString('en')} out.`,
  ];
  mkdirSync(join(ROOT, 'eval'), { recursive: true });
  writeFileSync(join(ROOT, 'eval', 'results.json'), JSON.stringify({ date: today, model, rows }, null, 2) + '\n');
  writeFileSync(join(ROOT, 'eval', 'results.md'), lines.join('\n') + '\n');
  process.stdout.write(lines.join('\n') + '\n');
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
});
