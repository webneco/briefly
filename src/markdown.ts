// The brief as Markdown, for the terminal, for pasting into notes, and for the .md download.

import { daysBetween, pretty, prettyShort, toDay } from './dates.ts';
import type { Brief, Claim, Line } from './types.ts';

function cites(claim: Claim): string {
  const ids = [...new Set(claim.evidence.map((e) => e.sourceId))];
  return ids.length ? ' ' + ids.map((id) => `[${id}]`).join('') : '';
}

function lineCites(line: Line, claims: Map<string, Claim>): string {
  const ids = new Set<string>();
  for (const ref of line.refs) for (const e of claims.get(ref)?.evidence ?? []) ids.add(e.sourceId);
  return ids.size ? ' ' + [...ids].map((id) => `[${id}]`).join('') : '';
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

export function meetingLine(brief: Brief): string {
  const day = toDay(brief.request.meetingAt);
  const today = toDay(brief.generatedAt);
  if (!day || !today) return brief.request.meetingAt;
  const gap = daysBetween(today, day);
  const when = gap === 0 ? 'today' : gap === 1 ? 'tomorrow' : gap > 1 ? `in ${gap} days` : `${-gap} day${gap === -1 ? '' : 's'} ago`;
  return `${pretty(day)} (${when})`;
}

export function toMarkdown(brief: Brief): string {
  const out: string[] = [];
  const claims = new Map([...brief.developments, ...brief.people, ...brief.reported].map((c) => [c.id, c]));
  const end = brief.window.end;

  out.push(`# Briefing: ${brief.entity.name}`);
  out.push('');
  out.push(`Meeting: ${meetingLine(brief)}${brief.request.purpose ? `. Purpose: ${brief.request.purpose}` : ''}  `);
  out.push(`Covers ${pretty(brief.window.start)} to ${pretty(brief.window.end)}.`);
  if (brief.entity.summary) {
    out.push('');
    out.push(`> ${brief.entity.summary}`);
  }
  if (brief.entity.ambiguity) {
    out.push('');
    out.push(`> Check the subject: ${brief.entity.ambiguity}`);
  }

  if (brief.quiet) {
    out.push('');
    out.push('## At a glance');
    out.push('');
    out.push(`No verified news about ${brief.entity.name} was found in these 30 days. Nothing has been added to fill the page.`);
  } else if (brief.glance.length) {
    out.push('');
    out.push('## At a glance');
    out.push('');
    for (const l of brief.glance) out.push(`- ${l.text}${lineCites(l, claims)}`);
  }

  if (brief.developments.length) {
    out.push('');
    out.push('## Key developments');
    out.push('');
    for (const c of brief.developments) out.push(`- **${c.date ? prettyShort(c.date, end) : 'Undated'}** ${c.text}${cites(c)}`);
  }
  if (brief.people.length) {
    out.push('');
    out.push('## People');
    out.push('');
    for (const c of brief.people) out.push(`- **${c.date ? prettyShort(c.date, end) : 'Undated'}** ${c.text}${cites(c)}`);
  }
  if (brief.reported.length) {
    out.push('');
    out.push('## Reported, not confirmed');
    out.push('');
    out.push('The sources themselves present these as unconfirmed. Each was checked to make sure the source says what is written here.');
    out.push('');
    for (const c of brief.reported) out.push(`- **${c.date ? prettyShort(c.date, end) : 'Undated'}** ${c.text}${cites(c)}`);
  }
  if (brief.talkingPoints.length) {
    out.push('');
    out.push('## Talking points');
    out.push('');
    for (const l of brief.talkingPoints) out.push(`- ${l.text}${lineCites(l, claims)}`);
  }
  if (brief.openQuestions.length) {
    out.push('');
    out.push('## Open questions');
    out.push('');
    for (const q of brief.openQuestions) out.push(`- ${q}`);
  }
  if (brief.unverified.length) {
    out.push('');
    out.push('## Not verified');
    out.push('');
    out.push('Drafted from the sources but held back, because a check failed. Treat these as leads, not facts.');
    out.push('');
    for (const c of brief.unverified) out.push(`- ${c.text}${cites(c)}  \n  Why held back: ${c.reason ?? 'no reason recorded'}`);
  }
  if (brief.sources.length) {
    out.push('');
    out.push('## Sources');
    out.push('');
    for (const s of brief.sources) out.push(`${s.id}. [${s.title || s.domain}](${s.url}), ${s.domain}, ${pretty(s.date)}`);
  }
  out.push('');
  out.push('---');
  out.push(
    `Made by Briefly with ${brief.researchedWith} and ${brief.model}: ${brief.usage.searches} searches, ${brief.usage.pagesRead} pages read, ` +
      `${count(brief.developments.length + brief.people.length, 'fact')} verified, ${count(brief.reported.length, 'unconfirmed report')}, ${brief.unverified.length} held back.`,
  );
  return out.join('\n') + '\n';
}
