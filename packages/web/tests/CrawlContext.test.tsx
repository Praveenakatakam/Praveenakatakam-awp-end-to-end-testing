import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CrawlProvider, useCrawl } from '../src/contexts/CrawlContext.js';
import type { Api } from '../src/api.js';

// Minimal fake api — CrawlProvider only calls api.refresh().
function fakeApiWith(refreshImpl: Api['refresh']): Api {
  return { refresh: refreshImpl } as unknown as Api;
}

describe('CrawlContext', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('useCrawl() throws a descriptive error when used outside CrawlProvider', () => {
    // GIVEN — no provider in the tree
    // WHEN / THEN
    expect(() => renderHook(() => useCrawl())).toThrow(
      'useCrawl must be used within a CrawlProvider',
    );
  });

  it('CrawlProvider renders its children and exposes default state', () => {
    // GIVEN
    const api = fakeApiWith(vi.fn().mockResolvedValue({}));
    // WHEN
    const { result } = renderHook(() => useCrawl(), {
      wrapper: ({ children }) => <CrawlProvider api={api}>{children}</CrawlProvider>,
    });
    // THEN — children mounted and initial state is idle
    expect(result.current.crawlRunning).toBe(false);
    expect(result.current.crawlElapsed).toBe(0);
    expect(result.current.crawlSummary).toBeNull();
    expect(result.current.crawlError).toBe('');
  });

  it('runRefresh() sets crawlRunning to true during the call and false after resolution', async () => {
    // GIVEN — a deferred promise so we control when refresh resolves
    let resolveRefresh!: (v: unknown) => void;
    const deferred = new Promise((res) => { resolveRefresh = res; });
    const api = fakeApiWith(vi.fn().mockReturnValue(deferred));
    const { result } = renderHook(() => useCrawl(), {
      wrapper: ({ children }) => <CrawlProvider api={api}>{children}</CrawlProvider>,
    });

    // WHEN — fire refresh without awaiting
    act(() => { void result.current.runRefresh(); });

    // THEN — running while the call is in-flight
    expect(result.current.crawlRunning).toBe(true);

    // WHEN — resolve the pending refresh
    await act(async () => {
      resolveRefresh({});
      await deferred;
    });

    // THEN — running cleared after resolution
    expect(result.current.crawlRunning).toBe(false);
  });

  it('crawlSummary is set to the resolved value after runRefresh() resolves', async () => {
    // GIVEN
    const summary = { crawled: 12, validated: 11, errors: 1 };
    const api = fakeApiWith(vi.fn().mockResolvedValue(summary));
    const { result } = renderHook(() => useCrawl(), {
      wrapper: ({ children }) => <CrawlProvider api={api}>{children}</CrawlProvider>,
    });

    // WHEN
    await act(async () => { await result.current.runRefresh(); });

    // THEN
    expect(result.current.crawlSummary).toEqual(summary);
    expect(result.current.crawlRunning).toBe(false);
    expect(result.current.crawlError).toBe('');
  });

  it('crawlError is set to the error message and crawlRunning is false after runRefresh() rejects', async () => {
    // GIVEN
    const api = fakeApiWith(vi.fn().mockRejectedValue(new Error('Network failure')));
    const { result } = renderHook(() => useCrawl(), {
      wrapper: ({ children }) => <CrawlProvider api={api}>{children}</CrawlProvider>,
    });

    // WHEN
    await act(async () => { await result.current.runRefresh(); });

    // THEN
    expect(result.current.crawlError).toBe('Network failure');
    expect(result.current.crawlRunning).toBe(false);
    expect(result.current.crawlSummary).toBeNull();
  });

  it('elapsed timer increments crawlElapsed while crawlRunning is true', async () => {
    // GIVEN — fake timers so we control Date.now() and setInterval
    vi.useFakeTimers();
    let resolveRefresh!: (v: unknown) => void;
    const deferred = new Promise((res) => { resolveRefresh = res; });
    const api = fakeApiWith(vi.fn().mockReturnValue(deferred));
    const { result } = renderHook(() => useCrawl(), {
      wrapper: ({ children }) => <CrawlProvider api={api}>{children}</CrawlProvider>,
    });

    // WHEN — start refresh so crawlRunning becomes true and the interval is registered
    act(() => { void result.current.runRefresh(); });
    expect(result.current.crawlRunning).toBe(true);

    // Advance fake clock by 500 ms — the interval fires every 100 ms → ~5 ticks
    act(() => { vi.advanceTimersByTime(500); });

    // THEN — elapsed updated (≈ 0.5 s)
    expect(result.current.crawlElapsed).toBeGreaterThan(0);
    expect(result.current.crawlElapsed).toBeLessThanOrEqual(1);

    // Cleanup — resolve the deferred so the provider teardown is clean
    await act(async () => {
      resolveRefresh({});
      await deferred;
    });

    // THEN — interval cleared, running reset
    expect(result.current.crawlRunning).toBe(false);
  });
});
