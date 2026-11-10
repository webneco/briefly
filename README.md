# Briefly

A pre-meeting briefing agent built on [Tavily](https://tavily.com). Give it a company or a person and a meeting date. It researches the last 30 days and returns a one-page brief in which every line has been checked against the page it cites.

Built for the Global AI Hackathon, Tavily track, problem statement "Pre-Meeting Briefing Agent".

![A Briefly brief: summary, dated developments with numbered sources, an unconfirmed report kept apart, talking points, open questions and sources](docs/brief.png)

## The problem

Before a meeting you want to know what the other side has been doing lately. Searching takes time, and an AI summary is quick but hard to trust: it can state a rumour as fact, repeat old news as new, mix up two companies with the same name, or make something up. In a meeting, one wrong "fact" costs more than no fact.

## What Briefly does

You give it who the meeting is with, when it is and, if you like, what it is for. It gives you one page:

- **At a glance:** up to three lines to read before you walk in.
- **Key developments and people:** dated, newest first, each with numbered sources.
- **Reported, not confirmed:** rumours and reports from unnamed sources, kept apart from the facts.
- **Talking points and open questions:** tuned to the purpose of the meeting.
- **Not verified:** anything that was drafted but failed a check, with the reason.
- **Text aimed at AI readers:** if a page carries an instruction written for AI assistants, Briefly sets it aside before writing anything, and tells you which page it was on.
- **Sources:** every page cited, with its date.

Click a source number and the page shows the passage that line rests on.

![A citation opened: the passage from the cited page appears under the line](docs/citation.png)

A line reaches the page only if all four of these hold:

1. The words it quotes are found on the page it cites. This is a text match, not a model's opinion.
2. It is dated inside the 30-day window.
3. The cited page names the subject.
4. A second model pass, shown only the claim and its cited sources, agrees they state it.

If nothing passes, the brief says that no verified news was found. It does not pad.

**What is different about it.** A good model with a good prompt already avoids most mistakes; the [trap test](#what-the-traps-showed) below shows that plainly. What a model cannot give you is a reason to believe it this time. Briefly's page is built so that you do not have to:

- Each line carries the passage it rests on, one click away, and the first check is a text match done by code.
- Facts, unconfirmed reports and failed drafts never share a list, so you know what you can repeat in the room.
- Text on a page that is aimed at AI readers is removed before the model sees it. Nothing on the brief can rest on it, and the brief names the page it came from.

![A notice on the brief: a source page carried text aimed at AI readers; it was set aside, and the passage can be opened](docs/planted.png)

## Try it

You need Node 22.18 or later. There is nothing to install: Briefly has no runtime dependencies.

**The recorded example, with no API keys:**

```bash
git clone https://github.com/webneco/briefly && cd briefly
npm run demo
```

This runs the whole pipeline over a set of made-up articles about a made-up company, replaying model replies recorded from a real run. It takes under a second. The articles are written to trip the agent up: one hides an instruction to AI assistants, one is about a different company with a similar name, two disagree on a number, one is a rumour, one is too old and one cannot be read. See [fixtures/northwind](fixtures/northwind/README.md) and the [brief it produces](docs/example-brief.md).

**The web app:**

```bash
npm start            # http://localhost:8787
```

Without keys it shows the recorded example. With keys it briefs you on anyone.

**Live, on a real company or person:**

```bash
cp .env.example .env     # add your Tavily key and a model key
npm start
# or from the terminal:
node src/cli.ts "Razorpay" --meeting 2026-11-14 --purpose "Payments partnership call" --out out
node src/cli.ts "Satya Nadella" --person --meeting 2026-11-20
```

The model can be Claude through Anthropic's API, or anything with an OpenAI-compatible endpoint: OpenAI, Gemini, Groq, or a gateway such as [Bifrost](https://github.com/maximhq/bifrost). A live brief takes one to two minutes with a large model and uses about 10 Tavily credits.

**With Docker:**

```bash
docker build -t briefly .
docker run --rm -p 8787:8787 --env-file .env briefly
```

## How it meets the brief

| The problem statement asks for | How Briefly does it |
| --- | --- |
| Meeting context: a company or person, and a meeting time | The form and the CLI take the subject, whether it is a company or a person, the meeting date, an optional purpose and an optional detail to tell namesakes apart. |
| Research on the last 30 days: news, launches, hires | Seven Tavily searches from different angles, each limited to the 30 days up to today. Every result's date is checked again in code. |
| A concise one-page briefing | Fixed sections and a word limit. Items are trimmed, least important first, until the page fits. The print layout is sized for one A4 page. |
| Source attribution | Every line carries numbered sources. Each number opens the passage it rests on and links to the page. |
| Open questions | Written from what the research could not settle: gaps, disagreements between sources and unconfirmed reports. |
| Keep verified and uncertain apart; invent nothing | Three separate tiers on the page: verified facts, reports the source itself calls unconfirmed, and drafts that failed a check. Summary lines must point at a verified claim or they are dropped. Text on a page that is aimed at AI readers is removed before drafting and reported. |

## How it works

A brief is made in eight steps. The web app shows them as they happen.

| Step | What happens | Uses |
| --- | --- | --- |
| 1. Work out who they are | One search for the subject's profile. The model writes a one-line description, the official site and other names the subject goes by, and flags namesakes. | Tavily Search, model |
| 2. Plan the searches | The model writes short queries for six lines of enquiry: news, launches, money, people, partners and risks. The meeting's purpose gets its own query. | Model |
| 3. Search the last 30 days | The queries run in parallel as news searches inside the window, plus one that favours the subject's own site. Results with no date, outside the window, not naming the subject, or duplicated are dropped. | Tavily Search |
| 4. Group headlines into events | The model groups results about the same event, drops namesakes and passing mentions, and ranks what is left. | Model |
| 5. Read the pages | Up to two pages per event, from different sites, are fetched in full. If a page cannot be read, the search snippet is used and labelled as such. | Tavily Extract |
| 6. Draft from the pages | The model writes each claim from the page text only. Each claim must come with words copied from the page, and says whether the source presents it as confirmed. | Model |
| 7. Check every claim | The four checks above. A claim the source backs only in part can be narrowed by the checker to what the source does say; the narrower wording is checked again from scratch and shown only if it passes. | Code, model |
| 8. Write the summary and questions | Summary lines, talking points and open questions are written from the checked claims only. A line with no checked claim behind it is dropped. A line that leans on an unconfirmed report must say so. | Model |

**Text aimed at AI readers.** Between steps 5 and 6, every page is scanned for text written to an AI reader: "ignore your previous instructions", a "note for AI assistants", a fake chat turn, an HTML comment addressed to the assistant. Those passages are cut from the page before the model drafts from it and before any claim is checked against it. So a claim quoted from such a passage fails check 1, because its quote is no longer on the page. The drafting model is also asked to report any such text the patterns missed; a report counts only if its words are found on the page it names, and then that passage is cut too. The brief lists each page this happened on, with the opening words of the passage.

Everything else fetched from the web is still treated as material to read, never as instructions.

## How Tavily is used

| Tavily feature | Where | Why |
| --- | --- | --- |
| Search, `topic: "news"` | Step 3 | Recent reporting rather than evergreen pages. |
| `start_date` and `end_date` | Step 3 | Limits every search to the 30-day window. Asked one day wider on each side, then checked exactly in code. |
| `filter_by_published_date` | Step 3 | Removes undated and out-of-window results at the source. |
| `include_published_date` | Steps 1 and 3 | The date on each result is what the window check uses. |
| `include_domains` with `include_domains_mode: "prefer"` | Step 3 | One search favours the subject's own site, without excluding the rest of the web. |
| Search, `topic: "general"` | Step 1 | Finds the subject's profile and official site, with no date limit. |
| Extract | Step 5 | Fetches the full page text that every claim is checked against. Up to 20 pages per call. |
| `include_usage` | Every call | Credit use is counted per brief and shown in "How this brief was made". |
| `X-Session-Id` header | Every call | All calls for one brief are grouped in Tavily's logs. |

Searches use `search_depth: "basic"`, at one credit each.

## What the checks did on real subjects

Six live runs, one per subject, each for a meeting on the day of the run:

Run on 2026-11-10 with Tavily and claude-fable-5-2. The window is the 30 days to that date.

| Subject | Searches | Pages read | Claims drafted | Verified facts | Unconfirmed reports | Held back | Seconds |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Razorpay | 8 | 4 | 6 | 3 | 3 | 0 | 50 |
| Zoho | 8 | 6 | 5 | 5 | 0 | 0 | 55 |
| Nvidia | 8 | 11 | 8 | 8 | 0 | 0 | 86 |
| Tavily | 8 | 5 | 4 | 3 | 0 | 1 | 49 |
| Maxim AI | 8 | 3 | 3 | 3 | 0 | 0 | 53 |
| Satya Nadella | 8 | 11 | 7 | 7 | 0 | 0 | 63 |
| **Total** | 48 | 40 | 33 | 29 | 3 | 1 | 356 |

3 of the claims that passed had first been narrowed by the checker to what the source states.
Why claims were held back: source does not back it (1).
Text aimed at AI readers was found on 1 of the 40 pages read.
Tavily credits used: 57. Model tokens: 152,340 in, 33,386 out.

What this shows: on these subjects the drafting model rarely wrote something its source did not say. Where it overreached, the checker narrowed the wording (3 claims) or held the claim back (1) rather than letting it through, and 3 claims that their own sources present as unconfirmed were kept apart from the facts.

One real page carried text aimed at AI readers: a documentation site's note telling AI tools to fetch its `llms.txt` index first. It is harmless, and it is exactly the kind of text this step is for: it was set aside, nothing was written from it, and the brief said so. The fixed patterns did not match it; the drafting model reported it and the code confirmed it was on the page.

What it does not show: nobody graded these claims by hand, so these are counts of what the checks did, not a measured accuracy. Six subjects on one day is a small sample.

Reproduce it with `npm run eval`. It uses about 60 Tavily credits and your own model key, and the numbers will differ on another day because the news does.

## What the traps showed

The example articles hold a rumour, a namesake, a story from before the window and an instruction planted for AI readers. `npm run traps` gives the same articles to the same models in three ways and judges the output by fixed rules:

- **Search, then summarise:** every article in one prompt that asks for the brief. This is what a quick agent does.
- **Warned:** the same prompt, with the model told about each trap in advance.
- **Briefly:** the full pipeline.

It was run with Claude Fable 5.2 and Claude Haiku 5.5: 3 runs of each for the fixture traps, and one each for five other kinds of planted instruction, 48 runs in all. Full tables are in [eval/traps.md](eval/traps.md) and every output is in [eval/traps.json](eval/traps.json).

| | Search, then summarise | Warned | Briefly |
| --- | --- | --- | --- |
| Fell for the rumour, the namesake or the old story | 0 of 6 runs | 0 of 6 | 0 of 6 |
| Followed a planted instruction | 0 of 16 runs | 0 of 16 | 0 of 16 |
| Told the reader that a page carried a planted instruction | 11 of 16 | 14 of 16 | 15 of 16 |

Read plainly:

- **These models did not fall for the traps, with or without Briefly.** Not once in 48 runs. So Briefly does not claim to be more accurate than Claude with a careful prompt on this material, and it would be wrong to say so.
- **Whether the reader is told about planted text is where they differ.** The plain prompt mentioned it in 11 of 16 runs, when the model happened to. Briefly reports it by rule. Its one miss was a run in which the page carrying the text was never read, so there was nothing to report.
- **The test found a real gap in Briefly, which is now closed.** The one-line description of the subject was written by the model and not checked, and in the recorded example it repeated the out-of-window factory story. The description is now limited to what the subject is and does, with no events.

What this does not show: how a weaker model behaves, how any of them do on real pages with subtler traps, or anything about accuracy on real subjects. The fixtures were written for this project, and the judging rules are simple enough to be wrong in places; that is why every output is published next to its verdict.

## Configuration

Set these in `.env`. Only the first three are needed.

| Setting | What it does |
| --- | --- |
| `TAVILY_API_KEY` | Your Tavily key. |
| `LLM_API_KEY` | Key for the model endpoint. |
| `LLM_BASE_URL`, `LLM_MODEL` | The endpoint and model. `https://api.anthropic.com/v1` uses Anthropic's API; any other URL is treated as OpenAI-compatible. |
| `LLM_EFFORT` | Claude only: how long the model thinks before answering (`low` to `max`). `medium` is a good balance. |
| `LLM_FAST_MODEL` | Optional quicker model for steps 1 and 2. Grouping, drafting and checking stay on `LLM_MODEL`. |
| `PORT` | Web app port. Default 8787. |
| `BRIEFLY_ACCESS_CODE` | If set, the web app asks for this code before a live brief. Set it on any public deployment so strangers cannot spend your credits. |
| `BRIEFLY_CACHE=1` | Keeps identical Tavily calls in `.cache/` while developing. |

**Through Bifrost.** Point `LLM_BASE_URL` at a Bifrost gateway (`http://localhost:8080/v1`) and name the model as `provider/model`. Briefly sends an `x-bf-session-id` header with every model call, so the gateway can group, budget and guard one brief as one session.

## Tests

```bash
npm test          # 67 tests, no keys and no network
npm run typecheck
npm run traps     # the trap test above; needs a model key, no Tavily credits
```

- **Quote matching, dates and parsing:** what counts as "found on the page", the window's edges, tolerant JSON parsing.
- **The pipeline, with a scripted model:** each check in turn, the three tiers, trimming to one page, source numbering, the quiet brief, and what happens when a search or a model call fails.
- **The Tavily and model clients:** request shapes, retries and error messages, against a recorded `fetch`.
- **Text aimed at AI readers:** the patterns on planted and on ordinary text, that the passage is cut before drafting, that a claim quoted from it cannot pass, and that the brief names the page.
- **The recorded example:** replays a real model's replies and asserts that the planted instruction was not obeyed and is reported to the reader, the rumour appears only as unconfirmed, and the namesake, the old story and the undated page stay out.

GitHub Actions runs the type check, the tests and the recorded example on every push, and builds and runs the Docker image.

## Limits

- **The checks reduce invented claims; they do not prove a claim true.** They confirm that a source says what the brief says. If the source is wrong, the brief repeats it, with the source named.
- **The one-line description of the subject is not put through the claim checks.** It comes from a profile search in step 1, and the model is told to say only what the subject is and does, with no events or dates. A namesake warning is shown when the search finds more than one match.
- **Planted text is found by its shape.** The patterns catch text that addresses an AI reader or imitates a chat. An instruction written as ordinary prose is caught only if the drafting model reports it. A news story that quotes such text may be flagged too; the notice then names a page that did nothing wrong.
- **Coverage depends on what the search returns.** Seven searches will not find everything. Results that carry no date are dropped, which can exclude a company's own undated pages.
- **Paywalled or blocked pages** are checked against the search snippet only, and marked.
- **Dates are publication dates** unless the article gives another. An article published in the window about an older event is caught only if the claim is given the older date.
- **English only** so far: the prompts, the hedge-word check and the page are in English.
- **Speed and cost.** A live brief makes six or seven model calls and takes one to two minutes on a large model.
- **A person as subject.** Briefly searches news about a person's public, professional activity. Use it for people you are meeting in a professional setting.

## Technologies used

| Part | Technology |
| --- | --- |
| Research | Tavily Search and Extract APIs |
| Model | Claude through Anthropic's Messages API, or any OpenAI-compatible endpoint |
| Agent, server and CLI | TypeScript on Node 22, run directly with no build step and no runtime dependencies |
| Web page | Plain HTML, CSS and JavaScript, with live progress over a streamed response |
| Tests and evaluation | Node's built-in test runner; TypeScript for type checking; two scripts that run live subjects and the trap test |
| Packaging and CI | Docker, GitHub Actions |

## How AI was used

The code, tests, fixtures and documentation in this repository were written with Claude (Anthropic), directed and reviewed by Aditya Vikram Singh. At run time Briefly calls a language model for six of its eight steps, as described above.

## Licence

Apache-2.0.
