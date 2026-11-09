import { join } from 'node:path';
import { FixtureResearch } from '../src/fixture.ts';
import { DEMO_DIR } from '../src/run.ts';
import type { BriefRequest, ChatResult, Model } from '../src/types.ts';

/** A model whose reply to each step is written by the test, so pipeline logic can be tested exactly. */
export class ScriptedModel implements Model {
  readonly name = 'scripted';
  calls: { task: string; system: string; user: string }[] = [];
  private replies: Record<string, unknown | ((user: string, nth: number) => unknown)>;

  constructor(replies: Record<string, unknown | ((user: string, nth: number) => unknown)>) {
    this.replies = replies;
  }

  async json<T>(task: string, system: string, user: string): Promise<ChatResult<T>> {
    const nth = this.calls.filter((c) => c.task === task).length;
    this.calls.push({ task, system, user });
    const reply = this.replies[task];
    if (reply === undefined) throw new Error(`no scripted reply for ${task}`);
    const value = typeof reply === 'function' ? (reply as (u: string, n: number) => unknown)(user, nth) : reply;
    if (value instanceof Error) throw value;
    return { value: value as T, tokensIn: 100, tokensOut: 50 };
  }
}

export function northwind(): FixtureResearch {
  return new FixtureResearch(join(DEMO_DIR, 'articles'));
}

export const REQUEST: BriefRequest = {
  subject: 'Northwind Robotics',
  kind: 'company',
  meetingAt: '2026-11-12',
  purpose: 'Pilot call',
  now: '2026-11-10',
};

export const PIN = { name: 'Northwind Robotics', summary: 'Rotterdam maker of warehouse picking robots.', domain: 'northwindrobotics.example', aliases: ['Northwind'], ambiguity: null };
export const PLAN = {
  queries: [
    { query: 'Northwind Robotics funding round', angle: 'money' },
    { query: 'Northwind Robotics Picker launch', angle: 'launch' },
    { query: 'Northwind Robotics Larchmont sale talks', angle: 'risk' },
    { query: 'Northwind Robotics Pune office', angle: 'news' },
    { query: 'Northwind Robotics Kestrel Freight agreement', angle: 'partners' },
  ],
};

/** Source ids are assigned in the order pages are chosen; tests look them up by a word in the title. */
export function sourceId(user: string, titleWord: string): string {
  const m = new RegExp(`<source id="(S\\d+)"[^>]*title="[^"]*${titleWord}[^"]*"`).exec(user);
  if (!m) throw new Error(`no source with "${titleWord}" in its title`);
  return m[1]!;
}
