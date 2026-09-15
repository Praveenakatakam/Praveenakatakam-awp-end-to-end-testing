/**
 * Jira REST API client + ADF text extraction (JR-03, JR-11, JR-15, NFR-J1; design §3.1, §3.2).
 *
 * Targets `GET /rest/api/3/search/jql`, the current cursor-paginated search
 * endpoint (`nextPageToken` + `isLast`), not the deprecated `startAt`-paginated
 * `GET /rest/api/3/search` (D-J12 — verified live against the BAWP project).
 */

export interface AdfDocument {
  type: string;
  version?: number;
  content?: AdfDocument[];
  text?: string;
}

/** A Jira issue as returned by the search endpoint (`fields` keyed by the configured AC field id). */
export interface JiraStory {
  key: string;
  fields: {
    [key: string]: unknown;
    parent?: { key: string; fields: { summary: string; issuetype: { name: string } } };
  };
}

interface JiraSearchPage {
  issues: JiraStory[];
  nextPageToken?: string;
  isLast: boolean;
}

export class JiraApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public body?: string
  ) {
    super(message);
    this.name = 'JiraApiError';
  }
}

export class JiraTimeoutError extends Error {
  constructor(message = 'Jira search exceeded the crawl time budget') {
    super(message);
    this.name = 'JiraTimeoutError';
  }
}

/** `Authorization: Basic …` header for Jira basic auth (email + API token). */
export function basicAuthHeader(email: string, apiToken: string): string {
  return 'Basic ' + Buffer.from(`${email}:${apiToken}`).toString('base64');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_429_RETRIES = 3;
const BACKOFF_MS = [1000, 2000, 4000];

/** Stateless, unit-testable client for the Jira JQL search endpoint (design §3.1). */
export class JiraApiClient {
  constructor(
    private baseUrl: string,
    private authHeader: string
  ) {}

  /** Paginates via `nextPageToken` until `isLast`; enforces a cumulative time budget across all pages. */
  async *search(jql: string, acFieldId: string, opts: { timeoutMs: number }): AsyncGenerator<JiraStory> {
    const deadline = Date.now() + opts.timeoutMs;
    let nextPageToken: string | undefined;
    while (true) {
      const page = await this.fetchPage(jql, acFieldId, nextPageToken, deadline);
      for (const issue of page.issues) yield issue;
      if (page.isLast || !page.nextPageToken) break;
      nextPageToken = page.nextPageToken;
    }
  }

  private async fetchPage(
    jql: string,
    acFieldId: string,
    nextPageToken: string | undefined,
    deadline: number
  ): Promise<JiraSearchPage> {
    if (Date.now() >= deadline) throw new JiraTimeoutError();

    const params = new URLSearchParams({ jql, fields: `key,${acFieldId}`, maxResults: '100' });
    if (nextPageToken) params.set('nextPageToken', nextPageToken);
    const url = `${this.baseUrl}/rest/api/3/search/jql?${params.toString()}`;

    for (let attempt = 0; ; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new JiraTimeoutError();

      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), remaining);
      let res: Response;
      try {
        res = await fetch(url, {
          headers: { Authorization: this.authHeader, Accept: 'application/json' },
          signal: controller.signal,
        });
      } catch (err) {
        if ((err as Error).name === 'AbortError') throw new JiraTimeoutError();
        throw new JiraApiError(`Jira request failed: ${(err as Error).message}`);
      } finally {
        clearTimeout(abortTimer);
      }

      if (res.ok) return (await res.json()) as JiraSearchPage;

      if (res.status === 429 && attempt < MAX_429_RETRIES) {
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      const body = await res.text().catch(() => '');
      throw new JiraApiError(`Jira search failed (${res.status})`, res.status, body);
    }
  }
}

// Block-level ADF node types whose descendant text becomes a single line.
const BLOCK_TYPES = new Set(['paragraph', 'heading', 'blockquote', 'codeBlock', 'listItem', 'panel']);

/** Depth-first flatten of an ADF document to plain text; one line per block-level node. */
export function extractAdfText(doc: AdfDocument | null | undefined): string {
  if (!doc) return '';
  const lines: string[] = [];

  const collectText = (node: AdfDocument): string => {
    let text = node.text ?? '';
    for (const child of node.content ?? []) text += collectText(child);
    return text;
  };

  const walk = (node: AdfDocument): void => {
    if (BLOCK_TYPES.has(node.type)) {
      const text = collectText(node);
      if (text) lines.push(text);
      return;
    }
    for (const child of node.content ?? []) walk(child);
  };

  walk(doc);
  return lines.join('\n');
}
