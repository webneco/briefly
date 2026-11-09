// Shared types. A brief is built from claims, and every claim carries the evidence it rests on.

export type Kind = 'company' | 'person';

export interface BriefRequest {
  /** The company or person the meeting is with. */
  subject: string;
  kind: Kind;
  /** When the meeting is, as an ISO date or date-time. */
  meetingAt: string;
  /** What the meeting is for, in the user's words. Shapes the talking points and questions. */
  purpose?: string;
  /** Extra words to tell namesakes apart, such as a city, sector or employer. */
  hint?: string;
  /** Overrides "today". Used by tests and the recorded demo so the 30-day window is fixed. */
  now?: string;
}

/** An inclusive range of calendar days, as YYYY-MM-DD. */
export interface DateWindow {
  start: string;
  end: string;
}

export interface EntityCard {
  name: string;
  kind: Kind;
  /** One sentence on who or what this is. */
  summary: string;
  /** Official website domain, when one was found. */
  domain: string | null;
  /** Other names the subject goes by, used to check that a page is about them. */
  aliases: string[];
  /** Set when the name could belong to someone or something else. */
  ambiguity: string | null;
}

export type Angle = 'news' | 'launch' | 'money' | 'people' | 'partners' | 'risk' | 'official';

export interface PlannedQuery {
  query: string;
  angle: Angle;
}

/** One search result that survived the date and relevance filters. */
export interface Hit {
  id: string;
  url: string;
  title: string;
  snippet: string;
  /** YYYY-MM-DD */
  date: string;
  domain: string;
  angle: Angle;
  score: number;
}

export type Category = 'product' | 'money' | 'people' | 'partners' | 'risk' | 'other';

/** Several headlines about the same thing, grouped. */
export interface NewsEvent {
  headline: string;
  date: string;
  category: Category;
  hitIds: string[];
  /** 3 matters most for someone about to meet the subject. */
  importance: 1 | 2 | 3;
}

export interface Source {
  /** S1, S2, ... as shown on the page. */
  id: string;
  url: string;
  title: string;
  domain: string;
  date: string;
  /** Page text the claims are checked against. */
  text: string;
  /** "page" when the full page was read, "snippet" when only the search snippet was available. */
  textFrom: 'page' | 'snippet';
}

export interface Quote {
  sourceId: string;
  /** Words copied from the source that the claim rests on. */
  quote: string;
}

export type ClaimStatus = 'verified' | 'unverified';

export interface Claim {
  /** C1, C2, ... */
  id: string;
  section: 'development' | 'people';
  text: string;
  /** When it happened, YYYY-MM-DD. */
  date: string | null;
  category: Category;
  quotes: Quote[];
  /**
   * False when the source itself presents this as a rumour, an anonymous-source report or a plan
   * nobody has confirmed. Such a claim can pass every check and still not be a settled fact.
   */
  confirmed: boolean;
  /** Position in the draft, where the most important item comes first. Used when trimming to one page. */
  rank: number;
  status: ClaimStatus;
  /** True when the checker narrowed the wording to what the source states. */
  reworded?: boolean;
  /** Why an unverified claim was held back, in plain words. */
  reason?: string;
  /** The passage around each matched quote, shown when a reader clicks a citation. */
  evidence: { sourceId: string; passage: string }[];
}

export interface Conflict {
  note: string;
  sourceIds: string[];
}

export interface Line {
  text: string;
  /** Claim ids this line rests on. */
  refs: string[];
}

export interface StepTrace {
  step: string;
  ms: number;
  detail: string;
}

export interface Usage {
  searches: number;
  pagesRead: number;
  tavilyCredits: number;
  llmCalls: number;
  llmTokensIn: number;
  llmTokensOut: number;
}

export interface Brief {
  request: BriefRequest;
  /** The day the brief was written, YYYY-MM-DD. */
  generatedAt: string;
  window: DateWindow;
  entity: EntityCard;
  /** True when no verified news was found in the window. The brief says so and pads nothing. */
  quiet: boolean;
  glance: Line[];
  developments: Claim[];
  people: Claim[];
  /** Checked against the source, but the source itself reports them as unconfirmed. */
  reported: Claim[];
  talkingPoints: Line[];
  openQuestions: string[];
  unverified: Claim[];
  /** Sources cited by at least one claim on the page, without their full text. */
  sources: Omit<Source, 'text'>[];
  /** What happened to every drafted claim, before the page was trimmed to fit. */
  tally: { drafted: number; facts: number; unconfirmed: number; heldBack: number; reworded: number };
  words: number;
  /** Where the research came from: "Tavily", or the fixture set in the offline demo. */
  researchedWith: string;
  model: string;
  usage: Usage;
  trace: StepTrace[];
}

export type Progress =
  | { type: 'step'; step: string; message: string }
  | { type: 'detail'; step: string; detail: string }
  | { type: 'done'; brief: Brief }
  | { type: 'error'; message: string };

// What the pipeline needs from the outside world. Tavily and a chat model in production;
// fixtures and recordings in tests and the offline demo.

export interface SearchParams {
  query: string;
  topic: 'news' | 'general';
  /** Limits results to these days. Left out only when looking up who the subject is. */
  window?: DateWindow;
  maxResults: number;
  /** Prefer results from these domains without excluding the rest of the web. */
  preferDomains?: string[];
}

export interface RawResult {
  url: string;
  title: string;
  content: string;
  score: number;
  publishedDate: string | null;
}

export interface Extracted {
  url: string;
  text: string;
}

export interface Research {
  readonly name: string;
  search(p: SearchParams): Promise<{ results: RawResult[]; credits: number }>;
  extract(urls: string[], about: string): Promise<{ pages: Extracted[]; failed: string[]; credits: number }>;
}

export interface ChatResult<T> {
  value: T;
  tokensIn: number;
  tokensOut: number;
}

export interface Model {
  readonly name: string;
  /** Sends one system and one user message and parses the reply as JSON. */
  json<T>(task: string, system: string, user: string): Promise<ChatResult<T>>;
}
