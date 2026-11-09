import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AnthropicModel, ChatModel, makeModel } from '../src/llm.ts';
import { Tavily } from '../src/tavily.ts';

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** A fetch that answers from a list and records what it was sent. */
function fakeFetch(replies: { status?: number; json?: unknown; text?: string }[]): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fn = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body ?? '{}')) });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)]!;
    return new Response(r.text ?? JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
  };
  return { fetch: fn as typeof fetch, calls };
}

const WINDOW = { start: '2026-10-11', end: '2026-11-10' };

test('Tavily search: news in a window, dated, one day wider on each side, grouped by session', async () => {
  const f = fakeFetch([{ json: { results: [{ url: 'https://a.example/x', title: 'T', content: 'C', score: 0.8, published_date: 'Mon, 02 Nov 2026 10:00:00 GMT' }, { title: 'no url' }], usage: { credits: 1 } } }]);
  const t = new Tavily({ apiKey: 'tvly-test', sessionId: 'briefly-1', fetch: f.fetch });
  const out = await t.search({ query: 'Acme', topic: 'news', window: WINDOW, maxResults: 6 });
  assert.deepEqual(out, { results: [{ url: 'https://a.example/x', title: 'T', content: 'C', score: 0.8, publishedDate: 'Mon, 02 Nov 2026 10:00:00 GMT' }], credits: 1 });
  const c = f.calls[0]!;
  assert.equal(c.url, 'https://api.tavily.com/search');
  assert.equal(c.headers.authorization, 'Bearer tvly-test');
  assert.equal(c.headers['x-session-id'], 'briefly-1');
  assert.deepEqual(c.body, {
    query: 'Acme',
    topic: 'news',
    search_depth: 'basic',
    max_results: 6,
    include_published_date: true,
    include_usage: true,
    start_date: '2026-10-10',
    end_date: '2026-11-11',
    filter_by_published_date: true,
  });
});

test('Tavily search: the official-site search prefers a domain without excluding the web', async () => {
  const f = fakeFetch([{ json: { results: [] } }]);
  await new Tavily({ apiKey: 'k', fetch: f.fetch }).search({ query: 'Acme announcement', topic: 'general', window: WINDOW, maxResults: 6, preferDomains: ['acme.example'] });
  const b = f.calls[0]!.body;
  assert.deepEqual(b.include_domains, ['acme.example']);
  assert.equal(b.include_domains_mode, 'prefer');
  assert.equal(b.filter_by_published_date, undefined);
});

test('Tavily search: no window means no date limits', async () => {
  const f = fakeFetch([{ json: { results: [] } }]);
  await new Tavily({ apiKey: 'k', fetch: f.fetch }).search({ query: 'Acme company official website', topic: 'general', maxResults: 6 });
  assert.equal('start_date' in f.calls[0]!.body, false);
});

test('Tavily: a wrong key gives a message that says what to fix, and is not retried', async () => {
  const f = fakeFetch([{ status: 401, json: { detail: { error: 'Unauthorized' } } }]);
  await assert.rejects(new Tavily({ apiKey: 'bad', fetch: f.fetch }).search({ query: 'x', topic: 'news', window: WINDOW, maxResults: 1 }), /Check TAVILY_API_KEY/);
  assert.equal(f.calls.length, 1);
});

test('Tavily: a server error is retried', async () => {
  const f = fakeFetch([{ status: 502, text: 'bad gateway' }, { json: { results: [] } }]);
  const out = await new Tavily({ apiKey: 'k', fetch: f.fetch }).search({ query: 'x', topic: 'news', window: WINDOW, maxResults: 1 });
  assert.deepEqual(out.results, []);
  assert.equal(f.calls.length, 2);
});

test('Tavily extract: batches of 20, failures listed, credits per five pages', async () => {
  const urls = Array.from({ length: 23 }, (_, i) => `https://a.example/${i}`);
  const f = fakeFetch([
    { json: { results: urls.slice(0, 18).map((url) => ({ url, raw_content: 'text' })), failed_results: [{ url: urls[18] }] } },
    { json: { results: urls.slice(20).map((url) => ({ url, raw_content: 'text' })) } },
  ]);
  const out = await new Tavily({ apiKey: 'k', fetch: f.fetch }).extract(urls, 'Acme');
  assert.equal(f.calls.length, 2);
  assert.equal((f.calls[0]!.body.urls as string[]).length, 20);
  assert.equal(out.pages.length, 21);
  // One reported failure, and one page that came back as neither a result nor a failure.
  assert.deepEqual(out.failed.sort(), [urls[18], urls[19]].sort());
  assert.equal(out.credits, 4 + 1);
});

test('OpenAI-compatible model: asks for JSON, counts tokens, sends the session header', async () => {
  const f = fakeFetch([{ json: { choices: [{ message: { content: '{"ok": true}' } }], usage: { prompt_tokens: 12, completion_tokens: 3 } } }]);
  const m = new ChatModel({ baseUrl: 'http://localhost:8080/v1', apiKey: 'sk', model: 'openai/gpt-4o-mini', sessionId: 'briefly-1', fetch: f.fetch });
  assert.deepEqual(await m.json('pin', 'sys', 'usr'), { value: { ok: true }, tokensIn: 12, tokensOut: 3 });
  const c = f.calls[0]!;
  assert.equal(c.url, 'http://localhost:8080/v1/chat/completions');
  assert.equal(c.headers['x-bf-session-id'], 'briefly-1');
  assert.deepEqual(c.body.response_format, { type: 'json_object' });
  assert.deepEqual(c.body.messages, [{ role: 'system', content: 'sys' }, { role: 'user', content: 'usr' }]);
});

test('OpenAI-compatible model: drops a field the endpoint rejects, then carries on', async () => {
  const f = fakeFetch([{ status: 400, text: 'Unsupported parameter: temperature' }, { json: { choices: [{ message: { content: '```json\n{"ok": 1}\n```' } }] } }]);
  const m = new ChatModel({ baseUrl: 'https://x.example/v1', apiKey: 'sk', model: 'm', fetch: f.fetch });
  assert.deepEqual((await m.json('pin', 's', 'u')).value, { ok: 1 });
  assert.equal('temperature' in f.calls[1]!.body, false);
});

test('Claude model: Messages API shape, thinking blocks ignored, effort passed through', async () => {
  const f = fakeFetch([{ json: { content: [{ type: 'thinking', thinking: '...' }, { type: 'text', text: '{"ok": true}' }], usage: { input_tokens: 20, output_tokens: 9 }, stop_reason: 'end_turn' } }]);
  const m = makeModel({ baseUrl: 'https://api.anthropic.com/v1', apiKey: 'sk-ant', model: 'claude-haiku-5-5', effort: 'medium', fetch: f.fetch });
  assert.ok(m instanceof AnthropicModel);
  assert.deepEqual(await m.json('draft', 'sys', 'usr'), { value: { ok: true }, tokensIn: 20, tokensOut: 9 });
  const c = f.calls[0]!;
  assert.equal(c.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(c.headers['x-api-key'], 'sk-ant');
  assert.equal(c.body.system, 'sys');
  assert.deepEqual(c.body.output_config, { effort: 'medium' });
  assert.ok((c.body.max_tokens as number) >= 16000);
});

test('Claude model: running out of room is reported plainly and not retried', async () => {
  const f = fakeFetch([{ json: { content: [{ type: 'thinking', thinking: '...' }], usage: { input_tokens: 20, output_tokens: 32000 }, stop_reason: 'max_tokens' } }]);
  const m = new AnthropicModel({ baseUrl: 'https://api.anthropic.com/v1', apiKey: 'k', model: 'claude-fable-5-2', fetch: f.fetch });
  await assert.rejects(m.json('draft', 's', 'u'), /ran out of room.*LLM_EFFORT/);
  assert.equal(f.calls.length, 1);
});

test('any other endpoint gets the OpenAI-compatible client', () => {
  assert.ok(makeModel({ baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'k', model: 'm' }) instanceof ChatModel);
});
