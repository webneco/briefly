// The web app: one page, and an endpoint that streams a brief's progress as it is made.

import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { missing, settings } from './config.ts';
import { toMarkdown } from './markdown.ts';
import { standalonePage } from './page.ts';
import { checkRequest, makeBrief } from './pipeline.ts';
import { demo, DEMO_REQUEST, DEMO_TAPE, live, ROOT } from './run.ts';
import type { Brief, BriefRequest, Progress } from './types.ts';

const WEB = join(ROOT, 'web');
const STATIC: Record<string, [file: string, type: string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
};
const MAX_BODY = 400_000;
/** Live briefs running at once. Each one spends Tavily credits and model tokens. */
const MAX_RUNNING = 2;
let running = 0;

const cfg = settings();
/** Set BRIEFLY_ACCESS_CODE on a public deployment so strangers cannot spend your credits. */
const accessCode = process.env.BRIEFLY_ACCESS_CODE ?? '';

function send(res: ServerResponse, status: number, body: string, type = 'application/json; charset=utf-8', extra: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': type, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', ...extra });
  res.end(body);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error('The request is too large.');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function stream(res: ServerResponse): (p: Progress) => void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    'x-accel-buffering': 'no',
    connection: 'keep-alive',
  });
  return (p) => res.write(`data: ${JSON.stringify(p)}\n\n`);
}

async function handleBrief(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: Partial<BriefRequest> & { code?: string };
  try {
    body = (await readJson(req)) as typeof body;
  } catch {
    return send(res, 400, JSON.stringify({ error: 'The request could not be read.' }));
  }
  const request: BriefRequest = {
    subject: String(body.subject ?? ''),
    kind: body.kind === 'person' ? 'person' : 'company',
    meetingAt: String(body.meetingAt ?? ''),
    purpose: body.purpose ? String(body.purpose) : undefined,
    hint: body.hint ? String(body.hint) : undefined,
    // The browser sends its own calendar date, so "the last 30 days" matches the user's clock.
    now: /^\d{4}-\d{2}-\d{2}$/.test(String(body.now ?? '')) ? String(body.now) : undefined,
  };
  const problem = checkRequest(request);
  if (problem) return send(res, 400, JSON.stringify({ error: problem }));
  if (accessCode && body.code !== accessCode) return send(res, 401, JSON.stringify({ error: 'That access code is not right.' }));
  const gaps = missing(cfg);
  if (gaps.length) {
    return send(res, 503, JSON.stringify({ error: `This server has no ${gaps.join(' or ')} set, so it can only show the recorded example.` }));
  }
  if (running >= MAX_RUNNING) return send(res, 429, JSON.stringify({ error: 'Two briefs are already being written. Try again in a minute.' }));

  running++;
  const emit = stream(res);
  try {
    const { research, model, fast } = live(cfg);
    await makeBrief(request, { research, model, fast, onProgress: emit });
  } catch (err) {
    emit({ type: 'error', message: (err as Error).message });
  } finally {
    running--;
    res.end();
  }
}

async function handleDemo(res: ServerResponse): Promise<void> {
  const emit = stream(res);
  try {
    const { research, model } = demo();
    // The recorded example replays instantly; a short pause per step lets a viewer follow it.
    await makeBrief(DEMO_REQUEST, {
      research,
      model,
      onProgress: (p) => {
        emit(p);
      },
    });
  } catch (err) {
    emit({ type: 'error', message: (err as Error).message });
  } finally {
    res.end();
  }
}

async function handleExport(req: IncomingMessage, res: ServerResponse, format: string): Promise<void> {
  let brief: Brief;
  try {
    brief = (await readJson(req)) as Brief;
    if (!brief?.entity?.name || !Array.isArray(brief.developments)) throw new Error('not a brief');
  } catch {
    return send(res, 400, JSON.stringify({ error: 'That is not a brief.' }));
  }
  const slug = brief.entity.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'brief';
  try {
    if (format === 'md') {
      return send(res, 200, toMarkdown(brief), 'text/markdown; charset=utf-8', { 'content-disposition': `attachment; filename="${slug}.md"` });
    }
    return send(res, 200, standalonePage(brief), 'text/html; charset=utf-8', { 'content-disposition': `attachment; filename="${slug}.html"` });
  } catch {
    return send(res, 400, JSON.stringify({ error: 'That brief could not be exported.' }));
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  const run = (p: Promise<void>) => p.catch(() => (res.headersSent ? res.end() : send(res, 500, JSON.stringify({ error: 'Something went wrong on the server.' }))));

  if (req.method === 'GET' && STATIC[path]) {
    const [file, type] = STATIC[path];
    return send(res, 200, readFileSync(join(WEB, file), 'utf8'), type);
  }
  if (req.method === 'GET' && path === '/api/status') {
    return send(
      res,
      200,
      JSON.stringify({ live: missing(cfg).length === 0, example: existsSync(DEMO_TAPE), model: cfg.llmModel, needsCode: accessCode !== '' }),
    );
  }
  if (req.method === 'POST' && path === '/api/brief') return void run(handleBrief(req, res));
  if (req.method === 'POST' && path === '/api/example') return void run(handleDemo(res));
  if (req.method === 'POST' && path === '/api/export/md') return void run(handleExport(req, res, 'md'));
  if (req.method === 'POST' && path === '/api/export/html') return void run(handleExport(req, res, 'html'));
  send(res, 404, JSON.stringify({ error: 'Not found.' }));
});

server.listen(cfg.port, () => {
  const gaps = missing(cfg);
  process.stdout.write(`Briefly is running at http://localhost:${cfg.port}\n`);
  if (gaps.length) process.stdout.write(`No ${gaps.join(' or ')} set: only the recorded example will work. See .env.example.\n`);
});
