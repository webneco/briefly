// Builds the real or the recorded dependencies for a run. Shared by the server, the CLI and the eval.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { missing, settings } from './config.ts';
import type { Settings } from './config.ts';
import { FixtureResearch, TapedModel } from './fixture.ts';
import { makeModel } from './llm.ts';
import { newSessionId } from './pipeline.ts';
import { Tavily } from './tavily.ts';
import type { BriefRequest, Model, Research } from './types.ts';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DEMO_DIR = join(ROOT, 'fixtures', 'northwind');
export const DEMO_TAPE = join(DEMO_DIR, 'model-tape.json');

/** The request the recorded demo answers. "now" is fixed so its 30-day window never moves. */
export const DEMO_REQUEST: BriefRequest = {
  subject: 'Northwind Robotics',
  kind: 'company',
  meetingAt: '2026-11-12',
  purpose: 'First call about piloting their picking robots in our Pune warehouse',
  hint: 'warehouse robotics, Rotterdam',
  now: '2026-11-10',
};

export interface Live {
  research: Research;
  model: Model;
  fast?: Model;
  sessionId: string;
}

/** Tavily and a real model. Throws a message naming any setting that is missing. */
export function live(s: Settings = settings()): Live {
  const gaps = missing(s);
  if (gaps.length) throw new Error(`Missing ${gaps.join(' and ')}. Copy .env.example to .env and fill it in.`);
  const sessionId = newSessionId();
  const model = makeModel({ baseUrl: s.llmBaseUrl, apiKey: s.llmKey, model: s.llmModel, sessionId, effort: s.llmEffort });
  const fast = s.llmFastModel ? makeModel({ baseUrl: s.llmBaseUrl, apiKey: s.llmKey, model: s.llmFastModel, sessionId }) : undefined;
  const tape = process.env.BRIEFLY_TAPE;
  return {
    sessionId,
    fast: fast && tape ? new TapedModel(tape.replace(/\.json$/, '') + '.fast.json', fast) : fast,
    research: new Tavily({ apiKey: s.tavilyKey, sessionId, cacheDir: s.cache ? join(ROOT, '.cache') : undefined }),
    // BRIEFLY_TAPE=<file> keeps model replies on disk, so a repeated run costs nothing.
    model: tape ? new TapedModel(tape, model) : model,
  };
}

/**
 * The offline demo: a made-up company, articles from fixtures/, and model replies recorded from
 * a real run. Pass record=true (with a model key set) to record the replies again.
 */
export function demo(record = false): { research: Research; model: Model } {
  const research = new FixtureResearch(join(DEMO_DIR, 'articles'));
  if (record) {
    const s = settings();
    if (!s.llmKey) throw new Error('Recording the demo needs LLM_API_KEY.');
    return { research, model: new TapedModel(DEMO_TAPE, makeModel({ baseUrl: s.llmBaseUrl, apiKey: s.llmKey, model: s.llmModel, effort: s.llmEffort })) };
  }
  if (!existsSync(DEMO_TAPE)) throw new Error('The recorded demo is missing (fixtures/northwind/model-tape.json).');
  return { research, model: new TapedModel(DEMO_TAPE, null) };
}
