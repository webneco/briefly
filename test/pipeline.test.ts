import assert from 'node:assert/strict';
import { test } from 'node:test';
import { windowFor } from '../src/dates.ts';
import { toMarkdown } from '../src/markdown.ts';
import { checkRequest, makeBrief } from '../src/pipeline.ts';
import { chooseSources, fallbackEvents, gather } from '../src/research.ts';
import type { Brief, Claim, EntityCard, RawResult, SearchParams, Source, Usage } from '../src/types.ts';
import { compose, focus, LIMITS, verify } from '../src/writing.ts';
import { northwind, PIN, PLAN, REQUEST, ScriptedModel, sourceId } from './helpers.ts';

const CARD: EntityCard = { name: 'Northwind Robotics', kind: 'company', summary: 'Robot maker.', domain: 'northwindrobotics.example', aliases: [], ambiguity: null };
const WINDOW = windowFor(REQUEST.meetingAt, REQUEST.now);
const usage = (): Usage => ({ searches: 0, pagesRead: 0, tavilyCredits: 0, llmCalls: 0, llmTokensIn: 0, llmTokensOut: 0 });

/** Groups every hit the model is shown into its own event, like a model that drops nothing. */
function everyHit(user: string) {
  const events = [...user.matchAll(/^(H\d+) \| (\d{4}-\d{2}-\d{2}) \| [^|]+ \| ([^|]+) \|/gm)].map((m) => ({
    headline: m[3]!.trim(),
    date: m[2],
    category: 'other',
    hits: [m[1]],
    importance: 2,
  }));
  return { events };
}

const allSupported = (user: string) => ({ checks: [...user.matchAll(/<claim id="(C\d+)"/g)].map((m) => ({ id: m[1], verdict: 'supported', why: '', fix: '' })) });

const KESTREL = 'Kestrel Freight will install 60 Northwind Robotics picking robots across four of its hubs in the Netherlands and Germany';
const PICKER = 'Picker 3 handles up to 1,100 picks per hour in tests at customer sites, compared with 800 for the previous model';
const RUMOUR = 'Northwind Robotics has held early talks with Larchmont Industrial about a possible sale';
const PUNE = 'Northwind Robotics plans to open an engineering and customer support office in Pune early next year';

function draftReply(user: string) {
  return {
    developments: [
      { text: 'Kestrel Freight will install 60 Northwind robots across four hubs.', date: '2026-11-05', category: 'partners', confirmed: true, quotes: [{ source: sourceId(user, 'Kestrel'), quote: KESTREL }] },
      { text: 'Northwind was acquired by Larchmont Industrial for €900 million.', date: '2026-11-07', category: 'money', confirmed: true, quotes: [{ source: sourceId(user, 'bought'), quote: 'Northwind Robotics has been acquired by Larchmont Industrial for nine hundred million euros in cash' }] },
      { text: 'A blog reports unconfirmed early sale talks with Larchmont Industrial.', date: '2026-11-07', category: 'money', confirmed: false, quotes: [{ source: sourceId(user, 'bought'), quote: RUMOUR }] },
      { text: 'Northwind launched Picker 3, which handles up to 1,100 picks per hour in tests.', date: '2026-11-03', category: 'product', confirmed: true, quotes: [{ source: sourceId(user, 'Picker'), quote: PICKER }] },
      { text: 'Northwind opened a factory in Rotterdam.', date: '2026-08-12', category: 'other', confirmed: true, quotes: [{ source: sourceId(user, 'Picker'), quote: PICKER }] },
      { text: 'Northwind plans a Pune office early next year.', date: '2026-11-01', category: 'other', confirmed: true, quotes: [{ source: sourceId(user, 'Pune'), quote: PUNE }] },
    ],
    people: [],
    conflicts: [{ note: 'One source says €40 million, another €45 million.', sources: [sourceId(user, '40 million'), sourceId(user, '45m')] }],
  };
}

function composeReply(user: string) {
  const id = (word: string) => new RegExp(`^(C\\d+) \\|[^\\n]*${word}`, 'm').exec(user)?.[1] ?? 'C0';
  return {
    glance: [
      { text: 'Kestrel Freight is installing 60 robots.', refs: [id('Kestrel')] },
      { text: 'Northwind is being sold to Larchmont.', refs: [id('sale talks')] },
      { text: 'A sale to Larchmont is reported but unconfirmed.', refs: [id('sale talks')] },
      { text: 'Northwind is profitable.', refs: [] },
      { text: 'Northwind won an award.', refs: ['C99'] },
    ],
    talking_points: [{ text: 'Ask about Picker 3 delivery dates.', refs: [id('Picker')] }],
    open_questions: ['Was the round €40 million or €45 million?'],
  };
}

async function fullRun(): Promise<{ brief: Brief; model: ScriptedModel }> {
  const model = new ScriptedModel({ pin: PIN, plan: PLAN, triage: everyHit, draft: draftReply, verify: allSupported, compose: composeReply });
  const brief = await makeBrief(REQUEST, { research: northwind(), model });
  return { brief, model };
}

test('a full run sorts claims into verified facts, unconfirmed reports and held-back drafts', async () => {
  const { brief } = await fullRun();
  assert.deepEqual(brief.window, { start: '2026-10-11', end: '2026-11-10' });
  assert.deepEqual(brief.developments.map((c) => c.text.slice(0, 22)), ['Kestrel Freight will i', 'Northwind launched Pic', 'Northwind plans a Pune']);
  assert.equal(brief.reported.length, 1);
  assert.match(brief.reported[0]!.text, /unconfirmed/);
  const held = brief.unverified.map((c) => [c.text.slice(0, 22), c.reason]);
  assert.deepEqual(held, [
    ['Northwind was acquired', 'The quoted words were not found on the cited page.'],
    ['Northwind opened a fac', 'It is dated 12 Aug 2026, outside the 30 days this brief covers.'],
  ]);
  assert.equal(brief.quiet, false);
});

test('the invented acquisition never reaches the verified page', async () => {
  const { brief } = await fullRun();
  const page = [...brief.glance, ...brief.talkingPoints].map((l) => l.text).concat(brief.developments.map((c) => c.text), brief.people.map((c) => c.text));
  assert.equal(page.some((t) => /acquired|being sold/.test(t)), false);
});

test('summary lines need a checked fact behind them, and a hedge when the fact is only reported', async () => {
  const { brief } = await fullRun();
  assert.deepEqual(brief.glance.map((l) => l.text), ['Kestrel Freight is installing 60 robots.', 'A sale to Larchmont is reported but unconfirmed.']);
});

test('sources are numbered in the order the page cites them, and uncited ones are left out', async () => {
  const { brief } = await fullRun();
  assert.deepEqual(brief.sources.map((s) => s.id), ['1', '2', '3', '4']);
  assert.match(brief.sources[0]!.title, /Kestrel/);
  assert.equal(brief.developments[0]!.evidence[0]!.sourceId, '1');
  assert.equal(brief.sources.some((s) => /Traders|factory|About/.test(s.title)), false);
  for (const s of brief.sources) assert.equal('text' in s, false);
});

test('a page that cannot be read is checked against its search snippet and labelled so', async () => {
  const { brief } = await fullRun();
  const pune = brief.sources.find((s) => /Pune/.test(s.title))!;
  assert.equal(pune.textFrom, 'snippet');
});

test('evidence passages come from the page, around the quote', async () => {
  const { brief } = await fullRun();
  assert.match(brief.developments[0]!.evidence[0]!.passage, /three-year agreement/);
});

test('the search filter drops undated, out-of-window, off-topic and duplicate results', async () => {
  // A source that ignores the date window, to prove the pipeline checks dates itself.
  const inner = northwind();
  const leaky = {
    name: 'leaky',
    search: (p: SearchParams) => inner.search({ ...p, window: undefined, maxResults: 20 }),
    extract: inner.extract.bind(inner),
  };
  const g = await gather(REQUEST, CARD, [{ query: 'Northwind Robotics', angle: 'news' }, { query: 'Northwind Robotics funding', angle: 'money' }], WINDOW, {
    research: leaky,
    model: new ScriptedModel({}),
    usage: usage(),
  });
  assert.ok(g.dropped.undated >= 1, 'the undated About page');
  assert.ok(g.dropped.outsideWindow >= 1, 'the August factory story');
  assert.ok(g.dropped.offTopic >= 1, 'Northwind Traders');
  assert.ok(g.dropped.duplicate >= 1, 'the same page from two searches');
  assert.equal(g.hits.some((h) => /Traders|factory|About/.test(h.title)), false);
  assert.equal(new Set(g.hits.map((h) => h.url)).size, g.hits.length);
  for (const h of g.hits) assert.ok(h.date >= WINDOW.start && h.date <= WINDOW.end);
  assert.deepEqual(g.hits.map((h) => h.id), g.hits.map((_, i) => `H${i + 1}`));
});

test('one failed search does not sink the brief, but a rejected key does', async () => {
  const inner = northwind();
  let n = 0;
  const flaky = {
    name: 'flaky',
    search: async (p: SearchParams): Promise<{ results: RawResult[]; credits: number }> => {
      if (n++ === 0) throw Object.assign(new Error('boom'), { status: 500 });
      return inner.search(p);
    },
    extract: inner.extract.bind(inner),
  };
  const deps = { research: flaky, model: new ScriptedModel({}), usage: usage() };
  const g = await gather(REQUEST, CARD, [{ query: 'Northwind Robotics', angle: 'news' }, { query: 'Northwind Robotics funding', angle: 'money' }], WINDOW, deps);
  assert.ok(g.hits.length > 0);
  const locked = { ...flaky, search: async () => Promise.reject(Object.assign(new Error('bad key'), { status: 401 })) };
  await assert.rejects(gather(REQUEST, CARD, [{ query: 'Northwind Robotics', angle: 'news' }], WINDOW, { ...deps, research: locked }), /bad key/);
});

test('reading picks at most two pages per event, from different sites', () => {
  const hit = (id: string, domain: string, score: number) => ({ id, url: `https://${domain}/${id}`, title: id, snippet: '', date: '2026-11-01', domain, angle: 'news' as const, score });
  const hits = [hit('H1', 'a.example', 0.9), hit('H2', 'a.example', 0.8), hit('H3', 'b.example', 0.7), hit('H4', 'c.example', 0.6)];
  const chosen = chooseSources([{ headline: 'x', date: '2026-11-01', category: 'other', hitIds: ['H1', 'H2', 'H3', 'H4'], importance: 3 }], hits);
  assert.deepEqual(chosen.map((h) => h.id), ['H1', 'H3']);
});

test('without a model, similar headlines still collapse into one event', () => {
  const hit = (id: string, title: string) => ({ id, url: `https://x.example/${id}`, title, snippet: '', date: '2026-11-01', domain: 'x.example', angle: 'news' as const, score: 0.5 });
  const events = fallbackEvents([hit('H1', 'Northwind Robotics raises €40 million Series B'), hit('H2', 'Northwind Robotics raises €40 million in Series B round'), hit('H3', 'Northwind names new CFO')]);
  assert.deepEqual(events.map((e) => e.hitIds), [['H1', 'H2'], ['H3']]);
});

// ---- verify(), directly ------------------------------------------------------------------------

const SRC: Source = {
  id: 'S1',
  url: 'https://news.example/a',
  title: 'Northwind raises money',
  domain: 'news.example',
  date: '2026-10-21',
  text: 'Northwind Robotics has raised €40 million in a Series B round led by Halden Ventures, the company said on Wednesday. Brightwater Capital also took part.',
  textFrom: 'page',
};
const QUOTE = 'Northwind Robotics has raised €40 million in a Series B round led by Halden Ventures';
const claim = (over: Partial<Claim> = {}): Claim => ({
  id: 'C1',
  section: 'development',
  text: 'Northwind raised €40 million in a Series B led by Halden Ventures.',
  date: '2026-10-21',
  category: 'money',
  quotes: [{ sourceId: 'S1', quote: QUOTE }],
  confirmed: true,
  rank: 0,
  status: 'unverified',
  evidence: [],
  ...over,
});
const deps = (model: ScriptedModel) => ({ research: northwind(), model, usage: usage() });

test('verify: a supported claim passes and carries its passage', async () => {
  const [c] = await verify(REQUEST, CARD, [claim()], [SRC], WINDOW, deps(new ScriptedModel({ verify: allSupported })));
  assert.equal(c!.status, 'verified');
  assert.equal(c!.reason, undefined);
  assert.match(c!.evidence[0]!.passage, /Series B round/);
});

test('verify: a claim with no date takes the date of the article it quotes', async () => {
  const [c] = await verify(REQUEST, CARD, [claim({ date: null })], [SRC], WINDOW, deps(new ScriptedModel({ verify: allSupported })));
  assert.equal(c!.date, '2026-10-21');
  assert.equal(c!.status, 'verified');
});

test('verify: the model is not asked about claims the page check already failed', async () => {
  const model = new ScriptedModel({ verify: allSupported });
  const out = await verify(REQUEST, CARD, [claim({ quotes: [{ sourceId: 'S1', quote: 'Northwind Robotics is now the largest robot maker in all of Europe' }] })], [SRC], WINDOW, deps(model));
  assert.equal(out[0]!.status, 'unverified');
  assert.equal(out[0]!.reason, 'The quoted words were not found on the cited page.');
  assert.equal(model.calls.length, 0);
});

test('verify: a quote too short to prove anything is refused', async () => {
  const [c] = await verify(REQUEST, CARD, [claim({ quotes: [{ sourceId: 'S1', quote: 'Series B round' }] })], [SRC], WINDOW, deps(new ScriptedModel({ verify: allSupported })));
  assert.equal(c!.reason, 'The supporting quote was too short to prove anything.');
});

test('verify: a page that does not name the subject cannot support a claim about it', async () => {
  const other: Source = { ...SRC, text: 'Northwind Traders, the speciality food wholesaler, has opened a new distribution centre in Seattle to serve restaurants.' };
  const c = claim({ text: 'Northwind opened a distribution centre in Seattle.', quotes: [{ sourceId: 'S1', quote: 'has opened a new distribution centre in Seattle to serve restaurants' }] });
  const [out] = await verify(REQUEST, CARD, [c], [other], WINDOW, deps(new ScriptedModel({ verify: allSupported })));
  assert.equal(out!.reason, 'The cited page does not name Northwind Robotics.');
});

test('verify: a partly supported claim is narrowed, checked again, and only then shown', async () => {
  const model = new ScriptedModel({
    verify: (_user: string, nth: number) =>
      nth === 0
        ? { checks: [{ id: 'C1', verdict: 'partly', why: 'The source gives no valuation', fix: 'Northwind raised €40 million in a Series B round led by Halden Ventures.' }] }
        : { checks: [{ id: 'C1', verdict: 'supported', why: '', fix: '' }] },
  });
  const [c] = await verify(REQUEST, CARD, [claim({ text: 'Northwind raised €40 million at a €300 million valuation.' })], [SRC], WINDOW, deps(model));
  assert.equal(c!.status, 'verified');
  assert.equal(c!.reworded, true);
  assert.equal(c!.text, 'Northwind raised €40 million in a Series B round led by Halden Ventures.');
  assert.equal(model.calls.length, 2);
  assert.match(model.calls[1]!.user, /Series B round led by Halden Ventures\.<\/claim>/);
});

test('verify: a narrowing that fails its own check keeps the claim held back, with the reason', async () => {
  const model = new ScriptedModel({ verify: { checks: [{ id: 'C1', verdict: 'partly', why: 'The source gives no valuation', fix: 'Northwind raised money at some valuation, sources say.' }] } });
  const [c] = await verify(REQUEST, CARD, [claim({ text: 'Northwind raised €40 million at a €300 million valuation.' })], [SRC], WINDOW, deps(model));
  assert.equal(c!.status, 'unverified');
  assert.equal(c!.text, 'Northwind raised €40 million at a €300 million valuation.');
  assert.equal(c!.reason, 'The source backs only part of this. The source gives no valuation.');
});

test('verify: an unsupported verdict, a missing verdict and a failed check all hold the claim back', async () => {
  const run = async (reply: unknown) => (await verify(REQUEST, CARD, [claim()], [SRC], WINDOW, deps(new ScriptedModel({ verify: reply }))))[0]!;
  assert.equal((await run({ checks: [{ id: 'C1', verdict: 'unsupported', why: 'The source says otherwise' }] })).reason, 'The source does not back this. The source says otherwise.');
  assert.equal((await run({ checks: [] })).reason, 'The second check gave no verdict on this.');
  assert.equal((await run(new Error('model down'))).reason, 'The second check could not be run.');
  assert.equal((await run(new Error('model down'))).status, 'unverified');
});

test('verify: only quotes that were found stay on the claim', async () => {
  const c = claim({ quotes: [{ sourceId: 'S1', quote: QUOTE }, { sourceId: 'S1', quote: 'Northwind Robotics is valued at three hundred million euros today' }] });
  const [out] = await verify(REQUEST, CARD, [c], [SRC], WINDOW, deps(new ScriptedModel({ verify: allSupported })));
  assert.equal(out!.quotes.length, 1);
  assert.equal(out!.evidence.length, 1);
});

// ---- the rest of the page ----------------------------------------------------------------------

test('nothing found: the brief says so and pads nothing', async () => {
  const model = new ScriptedModel({ pin: PIN, plan: PLAN, triage: { events: [] }, compose: { glance: [{ text: 'Invented.', refs: ['C1'] }], talking_points: [], open_questions: ['What has Northwind been working on?'] } });
  const brief = await makeBrief(REQUEST, { research: northwind(), model });
  assert.equal(brief.quiet, true);
  assert.deepEqual([brief.glance, brief.developments, brief.people, brief.reported, brief.unverified, brief.sources], [[], [], [], [], [], []]);
  assert.deepEqual(brief.openQuestions, ['What has Northwind been working on?']);
  assert.equal(model.calls.some((c) => c.task === 'draft' || c.task === 'verify'), false);
  assert.match(toMarkdown(brief), /No verified news about Northwind Robotics was found in these 30 days/);
});

test('the page is trimmed to one page, least important items first', async () => {
  const long = (n: number, src: string) => ({
    text: `Development number ${n}: Kestrel Freight will install sixty Northwind picking robots across four of its hubs in two countries under a new three-year agreement announced on Thursday this week.`,
    date: '2026-11-05',
    category: 'partners',
    confirmed: true,
    quotes: [{ source: src, quote: KESTREL }],
  });
  const model = new ScriptedModel({
    pin: PIN,
    plan: PLAN,
    triage: everyHit,
    draft: (user: string) => ({ developments: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => long(n, sourceId(user, 'Kestrel'))), people: [], conflicts: [] }),
    verify: allSupported,
    compose: (user: string) => {
      const ids = [...user.matchAll(/^(C\d+) \|/gm)].map((m) => m[1]);
      const filler = 'This line is here to take up room on the page and it runs to roughly twenty words in all, give or take.';
      return { glance: ids.slice(0, 3).map((id) => ({ text: filler, refs: [id] })), talking_points: ids.slice(0, 4).map((id) => ({ text: filler, refs: [id] })), open_questions: [filler, filler, filler, filler] };
    },
  });
  const brief = await makeBrief(REQUEST, { research: northwind(), model });
  assert.ok(brief.words <= LIMITS.pageWords, `${brief.words} words`);
  assert.ok(brief.developments.length <= LIMITS.developments);
  // The draft puts the most important first, so the first items survive.
  assert.match(brief.developments[0]!.text, /number 1:/);
  assert.equal(brief.developments.some((c) => /number 8:/.test(c.text)), false);
});

test('compose falls back to the checked facts when the model fails', async () => {
  const facts = [claim({ status: 'verified' }), claim({ id: 'C2', confirmed: false, status: 'verified', text: 'A sale is rumoured.' })];
  const out = await compose(REQUEST, CARD, facts, [], [{ note: 'Sources disagree on the amount.', sourceIds: [] }], WINDOW, deps(new ScriptedModel({ compose: new Error('down') })));
  assert.deepEqual(out.glance, [{ text: facts[0]!.text, refs: ['C1'] }]);
  assert.deepEqual(out.openQuestions, ['Which is right? Sources disagree on the amount.']);
});

test('focus() keeps the paragraphs that matter when a page is long', () => {
  const filler = Array.from({ length: 60 }, (_, i) => `Related story ${i}: something else entirely happened in another town today.`).join('\n');
  const page = `${filler}\nNorthwind Robotics has raised €40 million in a Series B round led by Halden Ventures.\n${filler}`;
  const kept = focus(page, ['Northwind Robotics'], ['Northwind raises Series B'], 1200);
  assert.ok(kept.length <= 1300);
  assert.match(kept, /raised €40 million/);
});

test('the Markdown brief has every section, with citations', async () => {
  const { brief } = await fullRun();
  const md = toMarkdown(brief);
  for (const h of ['# Briefing: Northwind Robotics', '## At a glance', '## Key developments', '## Reported, not confirmed', '## Talking points', '## Open questions', '## Not verified', '## Sources']) {
    assert.ok(md.includes(h), h);
  }
  assert.match(md, /- \*\*5 Nov\*\* Kestrel Freight will install 60 Northwind robots across four hubs\. \[1\]/);
  assert.match(md, /Why held back: The quoted words were not found on the cited page\./);
  assert.match(md, /Meeting: 12 Nov 2026 \(in 2 days\)/);
});

test('requests are checked before anything is spent', () => {
  assert.equal(checkRequest({ subject: 'Acme', kind: 'company', meetingAt: '2026-11-12' }), null);
  assert.equal(checkRequest({ subject: ' ', kind: 'company', meetingAt: '2026-11-12' }), 'Say who the meeting is with.');
  assert.equal(checkRequest({ subject: 'Acme', kind: 'company', meetingAt: 'soon' }), 'Give the meeting date.');
  assert.equal(checkRequest({ subject: 'Acme', kind: 'team' as never, meetingAt: '2026-11-12' }), 'Choose whether the meeting is with a company or a person.');
});

test('progress is reported step by step', async () => {
  const model = new ScriptedModel({ pin: PIN, plan: PLAN, triage: everyHit, draft: draftReply, verify: allSupported, compose: composeReply });
  const seen: string[] = [];
  await makeBrief(REQUEST, { research: northwind(), model, onProgress: (p) => seen.push(p.type === 'step' || p.type === 'detail' ? `${p.type}:${p.step}` : p.type) });
  assert.deepEqual(seen.filter((s) => s.startsWith('step:')), ['step:pin', 'step:plan', 'step:search', 'step:group', 'step:read', 'step:draft', 'step:verify', 'step:compose']);
  assert.equal(seen.at(-1), 'done');
});

test('ids are accepted however the model writes them', async () => {
  const model = new ScriptedModel({
    pin: PIN,
    plan: PLAN,
    // Numbers instead of "H1", and a bracketed source id.
    triage: (user: string) => ({ events: everyHit(user).events.map((e) => ({ ...e, hits: e.hits.map((h) => Number(String(h).slice(1))) })) }),
    draft: (user: string) => ({ developments: [{ text: 'Kestrel Freight will install 60 Northwind robots.', date: '2026-11-05', category: 'partners', confirmed: true, quotes: [{ source: `[${sourceId(user, 'Kestrel')}]`, quote: KESTREL }] }], people: [], conflicts: [] }),
    verify: { checks: [{ id: 1, verdict: 'supported', why: '', fix: '' }] },
    compose: { glance: [{ text: 'Kestrel Freight is installing 60 robots.', refs: ['c1'] }], talking_points: [], open_questions: [] },
  });
  const brief = await makeBrief(REQUEST, { research: northwind(), model });
  assert.equal(brief.developments.length, 1);
  assert.equal(brief.glance.length, 1);
});

test('an empty grouping is asked for once more before the brief is called quiet', async () => {
  const model = new ScriptedModel({
    pin: PIN,
    plan: PLAN,
    triage: (user: string, nth: number) => (nth === 0 ? { events: [] } : everyHit(user)),
    draft: draftReply,
    verify: allSupported,
    compose: composeReply,
  });
  const brief = await makeBrief(REQUEST, { research: northwind(), model });
  assert.equal(model.calls.filter((c) => c.task === 'triage').length, 2);
  assert.equal(brief.quiet, false);
});
