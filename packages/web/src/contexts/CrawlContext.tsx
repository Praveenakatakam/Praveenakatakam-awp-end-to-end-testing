/**
 * CrawlContext — encapsulates crawl/refresh state for the SPA.
 *
 * CrawlProvider holds crawlRunning, crawlElapsed, crawlSummary, crawlError,
 * and runRefresh(). Consumers call useCrawl() to access these values.
 *
 * The provider accepts an `api` prop (Api instance) so it can call
 * api.refresh(). It is intended to be instantiated by AppShell, which
 * owns the api instance.
 *
 * After a successful refresh this context does NOT reload contract data —
 * that responsibility stays with ContractDataContext. The two are decoupled.
 */
import { createContext, useContext, useEffect, useState } from 'react';
import type { Api } from '../api.js';

interface CrawlContextValue {
  crawlRunning: boolean;
  crawlElapsed: number;
  crawlSummary: any | null;
  crawlError: string;
  runRefresh: () => Promise<void>;
}

const CrawlContext = createContext<CrawlContextValue | undefined>(undefined);

export function CrawlProvider({ api, children }: { api: Api; children: React.ReactNode }) {
  const [crawlRunning, setCrawlRunning] = useState(false);
  const [crawlElapsed, setCrawlElapsed] = useState(0);
  const [crawlSummary, setCrawlSummary] = useState<any>(null);
  const [crawlError, setCrawlError] = useState('');

  useEffect(() => {
    if (!crawlRunning) return;
    const t0 = Date.now();
    const id = setInterval(() => setCrawlElapsed((Date.now() - t0) / 1000), 100);
    return () => clearInterval(id);
  }, [crawlRunning]);

  async function runRefresh() {
    setCrawlRunning(true); setCrawlElapsed(0); setCrawlSummary(null); setCrawlError('');
    try { const summary = await api.refresh(); setCrawlSummary(summary); }
    catch (err) { setCrawlError((err as Error).message); }
    finally { setCrawlRunning(false); }
  }

  return (
    <CrawlContext.Provider value={{ crawlRunning, crawlElapsed, crawlSummary, crawlError, runRefresh }}>
      {children}
    </CrawlContext.Provider>
  );
}

export function useCrawl(): CrawlContextValue {
  const ctx = useContext(CrawlContext);
  if (ctx === undefined) {
    throw new Error('useCrawl must be used within a CrawlProvider');
  }
  return ctx;
}
