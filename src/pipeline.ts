// Runs the eight steps in order and assembles the one-page brief.

import { randomUUID } from 'node:crypto';
import { localToday, windowFor } from './dates.ts';
import { chooseSources, gather, pinSubject, planSearches, readPages, triage } from './research.ts';
import type { Deps } from './research.ts';
import { wordCount } from './text.ts';
import type { Brief, BriefRequest, Claim, Line, Model, PlantedText, Progress, Research, Source, StepTrace, Usage } from './types.ts';
import { compose, draft, LIMITS, setAsidePlanted, verify } from './writing.ts';

export interface RunOptions {
  research: Research;
  model: Model;
  /** A quicker model for the two set-up steps. Defaults to the main model. */
  fast?: Model;
  onProgress?: (p: Progress) => void;
}

export function newSessionId(): string {
  return `briefly-${randomUUID().slice(0, 8)}`;
}

export function checkRequest(req: BriefRequest): string | null {
  if (!req.subject || req.subject.trim().length < 2) return 'Say who the meeting is with.';
  if (req.subject.length > 120) return 'Keep the name under 120 characters.';
  if (req.kind !== 'company' && req.kind !== 'person') return 'Choose whether the meeting is with a company or a person.';
  if (!req.meetingAt || Number.isNaN(Date.parse(req.meetingAt))) return 'Give the meeting date.';
  if (req.purpose && req.purpose.length > 300) return 'Keep the purpose under 300 characters.';
  if (req.hint && req.hint.length > 200) return 'Keep the extra detail under 200 characters.';
  return null;
}

export async function makeBrief(input: BriefRequest, opts: RunOptions): Promise<Brief> {
  const problem = checkRequest(input);
  if (problem) throw new Error(problem);
  const req: BriefRequest = { ...input, subject: input.subject.trim(), purpose: input.purpose?.trim() || undefined, hint: input.hint?.trim() || undefined };
  const usage: Usage = { searches: 0, pagesRead: 0, tavilyCredits: 0, llmCalls: 0, llmTokensIn: 0, llmTokensOut: 0 };
  const deps: Deps = { research: opts.research, model: opts.model, fast: opts.fast, usage };
  const trace: StepTrace[] = [];
  const window = windowFor(req.meetingAt, req.now);

  const step = async <T>(name: string, message: string, work: () => Promise<T>, detail: (value: T) => string): Promise<T> => {
    opts.onProgress?.({ type: 'step', step: name, message });
    const started = Date.now();
    const value = await work();
    const done = { step: name, ms: Date.now() - started, detail: detail(value) };
    trace.push(done);
    opts.onProgress?.({ type: 'detail', step: name, detail: done.detail });
    return value;
  };

  const entity = await step(
    'pin',
    `Working out who ${req.subject} is`,
    () => pinSubject(req, deps),
    (c) => (c.summary ? `${c.name}: ${c.summary}` : `No profile found; searching for "${c.name}" as given.`),
  );

  const queries = await step(
    'plan',
    'Planning the searches',
    () => planSearches(req, entity, window, deps),
    (q) => `${q.length} searches: ${q.map((x) => x.query).join(' · ')}`,
  );

  const gathered = await step(
    'search',
    `Searching the news from ${window.start} to ${window.end}`,
    () => gather(req, entity, queries, window, deps),
    (g) =>
      `${g.raw} results; kept ${g.hits.length}. Left out: ${g.dropped.offTopic} not about the subject, ${g.dropped.outsideWindow} outside the window, ` +
      `${g.dropped.undated} with no date, ${g.dropped.duplicate} duplicates.`,
  );

  const events = await step(
    'group',
    'Grouping headlines into events',
    () => triage(req, entity, gathered.hits, window, deps),
    (e) => (e.length ? `${e.length} events: ${e.map((x) => x.headline).join(' · ')}` : 'No events found in the window.'),
  );

  const sources = await step(
    'read',
    'Reading the pages',
    () => readPages(entity, chooseSources(events, gathered.hits), deps),
    (s) => `${s.filter((x) => x.textFrom === 'page').length} pages read in full, ${s.filter((x) => x.textFrom === 'snippet').length} from the search snippet only.`,
  );

  // Text aimed at AI readers is set aside before anything is written from the pages.
  const first = setAsidePlanted(sources);

  const drafted = await step(
    'draft',
    'Drafting from the pages',
    () => draft(req, entity, events, first.sources, window, deps),
    (d) => `${d.claims.length} claims drafted, ${d.conflicts.length} disagreement${d.conflicts.length === 1 ? '' : 's'} between sources noted.`,
  );

  // The drafting model may have spotted more of it. That goes too, before the checks run.
  const second = setAsidePlanted(first.sources, drafted.planted);
  const pages = second.sources;
  const planted = [...first.notes, ...second.notes.filter((n) => !first.notes.some((x) => x.sourceId === n.sourceId))].slice(0, 3);

  const checked = await step(
    'verify',
    'Checking every claim against its source',
    () => verify(req, entity, drafted.claims, pages, window, deps),
    (c) =>
      `${c.filter((x) => x.status === 'verified').length} passed` +
      (c.some((x) => x.reworded) ? ` (${c.filter((x) => x.reworded).length} after narrowing the wording to what the source states)` : '') +
      (c.some((x) => x.status === 'verified' && !x.confirmed) ? `, of which ${c.filter((x) => x.status === 'verified' && !x.confirmed).length} the source itself calls unconfirmed` : '') +
      `; ${c.filter((x) => x.status === 'unverified').length} held back.` +
      (planted.length ? ` Text aimed at AI readers was found on ${planted.length} page${planted.length === 1 ? '' : 's'} and set aside.` : ''),
  );

  const byDate = (a: Claim, b: Claim) => ((a.date ?? '') < (b.date ?? '') ? 1 : (a.date ?? '') > (b.date ?? '') ? -1 : a.rank - b.rank);
  const verified = checked.filter((c) => c.status === 'verified');
  // Three tiers, kept apart on the page: checked facts, checked reports the source itself calls
  // unconfirmed, and drafts that failed a check.
  let developments = verified.filter((c) => c.confirmed && c.section === 'development').slice(0, LIMITS.developments).sort(byDate);
  let people = verified.filter((c) => c.confirmed && c.section === 'people').slice(0, LIMITS.people).sort(byDate);
  let reported = verified.filter((c) => !c.confirmed).slice(0, LIMITS.reported).sort(byDate);
  let unverified = checked.filter((c) => c.status === 'unverified').slice(0, LIMITS.unverified);

  const composed = await step(
    'compose',
    'Writing the summary and questions',
    () => compose(req, entity, [...developments, ...people, ...reported], unverified, drafted.conflicts, window, deps),
    (c) => `${c.glance.length} summary lines, ${c.talkingPoints.length} talking points, ${c.openQuestions.length} open questions.`,
  );
  let { glance, talkingPoints, openQuestions } = composed;

  // Keep to one page: trim the least important items until the body fits.
  const size = () =>
    wordCount(
      [
        ...glance.map((l) => l.text),
        ...developments.map((c) => c.text),
        ...people.map((c) => c.text),
        ...reported.map((c) => c.text),
        ...talkingPoints.map((l) => l.text),
        ...openQuestions,
        ...unverified.flatMap((c) => [c.text, c.reason ?? '']),
        ...planted.map((p) => p.excerpt),
      ].join(' '),
    );
  const trims: (() => boolean)[] = [
    () => unverified.length > 2 && (unverified = unverified.slice(0, -1), true),
    () => talkingPoints.length > 3 && (talkingPoints = talkingPoints.slice(0, -1), true),
    () => openQuestions.length > 3 && (openQuestions = openQuestions.slice(0, -1), true),
    () => developments.length > 5 && (developments = dropLeast(developments), true),
    () => reported.length > 2 && (reported = dropLeast(reported), true),
    () => people.length > 2 && (people = dropLeast(people), true),
    () => developments.length > 4 && (developments = dropLeast(developments), true),
    () => unverified.length > 1 && (unverified = unverified.slice(0, -1), true),
  ];
  for (let guard = 0; size() > LIMITS.pageWords && guard < 20; guard++) {
    if (!trims.some((t) => t())) break;
  }
  const shown = new Set([...developments, ...people, ...reported].map((c) => c.id));
  const keepRefs = (lines: Line[]) => lines.map((l) => ({ ...l, refs: l.refs.filter((r) => shown.has(r)) })).filter((l) => l.refs.length > 0);
  glance = keepRefs(glance);
  talkingPoints = keepRefs(talkingPoints);

  const cited = renumber([...developments, ...people, ...reported, ...unverified], sources, planted);

  const brief: Brief = {
    request: req,
    generatedAt: req.now ?? localToday(),
    window,
    entity,
    quiet: developments.length + people.length + reported.length === 0,
    glance,
    developments,
    people,
    reported,
    talkingPoints,
    openQuestions,
    unverified,
    planted,
    sources: cited,
    tally: {
      drafted: checked.length,
      facts: verified.filter((c) => c.confirmed).length,
      unconfirmed: verified.filter((c) => !c.confirmed).length,
      heldBack: checked.length - verified.length,
      reworded: checked.filter((c) => c.reworded).length,
    },
    words: size(),
    researchedWith: opts.research.name,
    model: opts.model.name,
    usage,
    trace,
  };
  opts.onProgress?.({ type: 'done', brief });
  return brief;
}

/** Drops the item the draft ranked least important. */
function dropLeast(list: Claim[]): Claim[] {
  const least = list.reduce((a, b) => (b.rank > a.rank ? b : a));
  return list.filter((c) => c !== least);
}

/**
 * Renumbers sources 1, 2, 3 in the order the page first cites them, and returns only the
 * sources that are cited. Claims and notices of planted text are updated to the new ids.
 */
function renumber(claims: Claim[], sources: Source[], planted: PlantedText[] = []): Omit<Source, 'text'>[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const fresh = new Map<string, string>();
  const out: Omit<Source, 'text'>[] = [];
  const cite = (sourceId: string) => {
    if (fresh.has(sourceId)) return;
    const s = byId.get(sourceId);
    if (!s) return;
    const id = String(out.length + 1);
    fresh.set(sourceId, id);
    out.push({ id, url: s.url, title: s.title, domain: s.domain, date: s.date, textFrom: s.textFrom });
  };
  for (const c of claims) for (const e of c.evidence) cite(e.sourceId);
  // A page with planted text is listed even when nothing on the brief rests on it.
  for (const p of planted) {
    cite(p.sourceId);
    p.sourceId = fresh.get(p.sourceId) ?? p.sourceId;
  }
  for (const c of claims) {
    c.evidence = c.evidence.filter((e) => fresh.has(e.sourceId)).map((e) => ({ ...e, sourceId: fresh.get(e.sourceId)! }));
    c.quotes = c.quotes.filter((q) => fresh.has(q.sourceId)).map((q) => ({ ...q, sourceId: fresh.get(q.sourceId)! }));
  }
  return out;
}
