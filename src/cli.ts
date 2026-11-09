// Command line: node src/cli.ts "Acme Corp" --meeting 2026-11-14 --purpose "renewal call"

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { localToday } from './dates.ts';
import { toMarkdown } from './markdown.ts';
import { makeBrief } from './pipeline.ts';
import { standalonePage } from './page.ts';
import { demo, DEMO_REQUEST, live } from './run.ts';
import type { BriefRequest, Model, Research } from './types.ts';

const HELP = `Briefly: a one-page, sourced brief on who you are about to meet.

Usage
  node src/cli.ts <company or person> [options]
  node src/cli.ts --demo            run the recorded demo, no keys needed

Options
  --person                the subject is a person (default: a company)
  --meeting <date>        when the meeting is, e.g. 2026-11-14 (default: today)
  --purpose <text>        what the meeting is for
  --hint <text>           words that tell the subject apart from namesakes
  --out <dir>             also write <name>.md, <name>.html and <name>.json there
  --json                  print the brief as JSON instead of Markdown
  --quiet                 do not print progress
  --record                with --demo: record the model replies again (needs a model key)
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (name: string) => args.includes(name);
  const value = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
  };
  if (flag('--help') || flag('-h') || args.length === 0) {
    process.stdout.write(HELP);
    return;
  }

  let req: BriefRequest;
  let research: Research;
  let model: Model;
  let fast: Model | undefined;
  if (flag('--demo')) {
    req = DEMO_REQUEST;
    ({ research, model } = demo(flag('--record')));
  } else {
    const valued = new Set(['--meeting', '--purpose', '--hint', '--out']);
    const subject = args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1] ?? '')).join(' ');
    req = {
      subject,
      kind: flag('--person') ? 'person' : 'company',
      meetingAt: value('--meeting') ?? localToday(),
      purpose: value('--purpose'),
      hint: value('--hint'),
    };
    ({ research, model, fast } = live());
  }

  const quiet = flag('--quiet');
  const brief = await makeBrief(req, {
    research,
    model,
    fast,
    onProgress: (p) => {
      if (!quiet && p.type === 'step') process.stderr.write(`  ${p.message} ...\n`);
    },
  });

  process.stdout.write(flag('--json') ? JSON.stringify(brief, null, 2) + '\n' : toMarkdown(brief));

  const out = value('--out');
  if (out) {
    mkdirSync(out, { recursive: true });
    const slug = brief.entity.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'brief';
    writeFileSync(join(out, `${slug}.md`), toMarkdown(brief));
    writeFileSync(join(out, `${slug}.json`), JSON.stringify(brief, null, 2) + '\n');
    writeFileSync(join(out, `${slug}.html`), standalonePage(brief));
    if (!quiet) process.stderr.write(`  Saved ${slug}.md, ${slug}.html and ${slug}.json in ${out}\n`);
  }
  if (!quiet) {
    const u = brief.usage;
    process.stderr.write(
      `  ${u.searches} searches, ${u.pagesRead} pages read, ${u.tavilyCredits} Tavily credits, ${u.llmCalls} model calls ` +
        `(${u.llmTokensIn} tokens in, ${u.llmTokensOut} out).\n`,
    );
  }
}

main().catch((err) => {
  process.stderr.write(`\n${(err as Error).message}\n`);
  process.exit(1);
});
