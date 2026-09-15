import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractAdfText, JiraApiClient, JiraApiError, JiraTimeoutError, basicAuthHeader, type AdfDocument } from '../src/jira.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('extractAdfText (design §3.2)', () => {
  it('returns "" for null/undefined input', () => {
    expect(extractAdfText(null)).toBe('');
    expect(extractAdfText(undefined)).toBe('');
  });

  it('returns "" for an empty doc', () => {
    const doc: AdfDocument = { type: 'doc', content: [] };
    expect(extractAdfText(doc)).toBe('');
  });

  it('flattens a single paragraph', () => {
    const doc: AdfDocument = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Given a user is logged in' }] }],
    };
    expect(extractAdfText(doc)).toBe('Given a user is logged in');
  });

  it('joins multiple paragraphs with newlines', () => {
    const doc: AdfDocument = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Given a user is logged in' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'When they click submit' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Then the form is saved' }] },
      ],
    };
    expect(extractAdfText(doc)).toBe('Given a user is logged in\nWhen they click submit\nThen the form is saved');
  });

  it('concatenates nested inline marks (bold/italic runs) within one block without extra newlines', () => {
    const doc: AdfDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'The system ' },
            { type: 'text', text: 'SHALL', marks: [{ type: 'strong' }] } as AdfDocument,
            { type: 'text', text: ' validate input.' },
          ],
        },
      ],
    };
    expect(extractAdfText(doc)).toBe('The system SHALL validate input.');
  });

  it('flattens a bullet list (nested block content) into one line per list item', () => {
    const doc: AdfDocument = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first criterion' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second criterion' }] }] },
          ],
        },
      ],
    };
    expect(extractAdfText(doc)).toBe('first criterion\nsecond criterion');
  });
});

describe('basicAuthHeader', () => {
  it('base64-encodes email:token as a Basic auth header', () => {
    expect(basicAuthHeader('svc@collegeboard.org', 'tok-123')).toBe(
      `Basic ${Buffer.from('svc@collegeboard.org:tok-123').toString('base64')}`
    );
  });
});

describe('JiraApiClient.search (JR-03, JR-15, NFR-J1; design §3.1)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function drain(gen: AsyncGenerator<{ key: string }>): Promise<string[]> {
    const keys: string[] = [];
    for await (const issue of gen) keys.push(issue.key);
    return keys;
  }

  it('yields every issue from a single page (isLast=true)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ issues: [{ key: 'BAWP-1' }, { key: 'BAWP-2' }], isLast: true }));
    const client = new JiraApiClient('https://collegeboard.atlassian.net', 'Basic xyz');
    const keys = await drain(client.search('project = BAWP', 'customfield_11048', { timeoutMs: 20_000 }));
    expect(keys).toEqual(['BAWP-1', 'BAWP-2']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/rest/api/3/search/jql?');
    expect(String(url)).toContain('maxResults=100');
  });

  it('follows nextPageToken across multiple pages', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ issues: [{ key: 'BAWP-1' }], isLast: false, nextPageToken: 'tok-1' }))
      .mockResolvedValueOnce(jsonResponse({ issues: [{ key: 'BAWP-2' }], isLast: true }));
    const client = new JiraApiClient('https://collegeboard.atlassian.net', 'Basic xyz');
    const keys = await drain(client.search('project = BAWP', 'customfield_11048', { timeoutMs: 20_000 }));
    expect(keys).toEqual(['BAWP-1', 'BAWP-2']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [secondUrl] = fetchMock.mock.calls[1];
    expect(String(secondUrl)).toContain('nextPageToken=tok-1');
  });

  it('yields nothing for an empty result set', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ issues: [], isLast: true }));
    const client = new JiraApiClient('https://collegeboard.atlassian.net', 'Basic xyz');
    const keys = await drain(client.search('project = BAWP', 'customfield_11048', { timeoutMs: 20_000 }));
    expect(keys).toEqual([]);
  });

  it('throws JiraTimeoutError once cumulative elapsed time exceeds the budget, without fetching another page', async () => {
    vi.useFakeTimers();
    const start = new Date('2026-09-08T00:00:00.000Z');
    vi.setSystemTime(start);
    fetchMock.mockImplementationOnce(async () => {
      vi.setSystemTime(new Date(start.getTime() + 25_000)); // jump past the 20s budget
      return jsonResponse({ issues: [{ key: 'BAWP-1' }], isLast: false, nextPageToken: 'tok-1' });
    });
    const client = new JiraApiClient('https://collegeboard.atlassian.net', 'Basic xyz');
    await expect(drain(client.search('project = BAWP', 'customfield_11048', { timeoutMs: 20_000 }))).rejects.toBeInstanceOf(
      JiraTimeoutError
    );
    expect(fetchMock).toHaveBeenCalledTimes(1); // never attempted the second page
  });

  it('retries HTTP 429 with exponential backoff (1s/2s/4s) then succeeds', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse({ issues: [{ key: 'BAWP-1' }], isLast: true }));
    const client = new JiraApiClient('https://collegeboard.atlassian.net', 'Basic xyz');
    const gen = client.search('project = BAWP', 'customfield_11048', { timeoutMs: 20_000 });
    const resultPromise = drain(gen);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    const keys = await resultPromise;
    expect(keys).toEqual(['BAWP-1']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gives up after 3 retries of HTTP 429 and throws JiraApiError', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(jsonResponse({}, 429));
    const client = new JiraApiClient('https://collegeboard.atlassian.net', 'Basic xyz');
    const gen = client.search('project = BAWP', 'customfield_11048', { timeoutMs: 20_000 });
    const resultPromise = drain(gen).catch((err) => err);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000);
    const err = await resultPromise;
    expect(err).toBeInstanceOf(JiraApiError);
    expect((err as JiraApiError).status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });

  it('throws JiraApiError immediately on HTTP 401 (no retry)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errorMessages: ['unauthorized'] }, 401));
    const client = new JiraApiClient('https://collegeboard.atlassian.net', 'Basic xyz');
    const err = await drain(client.search('project = BAWP', 'customfield_11048', { timeoutMs: 20_000 })).catch((e) => e);
    expect(err).toBeInstanceOf(JiraApiError);
    expect((err as JiraApiError).status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('wraps a network failure (fetch rejects) as JiraApiError', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const client = new JiraApiClient('https://collegeboard.atlassian.net', 'Basic xyz');
    const err = await drain(client.search('project = BAWP', 'customfield_11048', { timeoutMs: 20_000 })).catch((e) => e);
    expect(err).toBeInstanceOf(JiraApiError);
  });
});
