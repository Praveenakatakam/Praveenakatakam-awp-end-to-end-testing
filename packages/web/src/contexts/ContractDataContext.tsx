/**
 * ContractDataContext — provides contract entries and entity groups to the
 * /source route subtree without re-fetching on every navigation.
 *
 * ContractDataProvider fetches contract data on mount via the same logic
 * as App.tsx's load() function: listContracts() → groupByEntity() →
 * per-group getEntity() calls for multi-variant entities to apply divergence
 * flags. Consumers call useContractData() to access entries, groups,
 * loading, error, and reload().
 *
 * The provider renders <Outlet /> so it can act as the route element for
 * the /source parent route, wrapping all child routes.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import type { Api } from '../api.js';
import { applyEntityDivergence, groupByEntity, type Entry, type EntityGroup } from '../lib.js';

interface ContractDataContextValue {
  entries: Entry[];
  groups: EntityGroup[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export const ContractDataContext = createContext<ContractDataContextValue | undefined>(undefined);

export function ContractDataProvider({ api, children }: { api: Api; children?: React.ReactNode }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [groups, setGroups] = useState<EntityGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api.listContracts().then((items) => {
      if (cancelled) return;
      setEntries(items);
      const initial = groupByEntity(items);
      setGroups(initial);
      setLoading(false);

      const multiVariant = initial.filter((g) => g.variants.length > 1);
      // Run per-entity diff checks in parallel. Errors here are non-fatal —
      // the initial divergence flag (from hash comparison) is already set.
      // Promise.allSettled prevents individual getEntity failures from
      // propagating to the outer .catch() and overwriting the loaded groups.
      Promise.allSettled(
        multiVariant.map(async (g) => {
          try {
            const result = await api.getEntity(g.entity);
            if (cancelled || !result) return;
            setGroups((prev) => applyEntityDivergence(prev, result));
          } catch {
            // Non-fatal: divergence flag from hash comparison remains
          }
        })
      );
    }).catch((err: unknown) => {
      if (cancelled) return;
      setError((err as Error).message ?? String(err));
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [api, fetchCount]);

  const reload = useCallback(() => {
    setFetchCount((n) => n + 1);
  }, []);

  return (
    <ContractDataContext.Provider value={{ entries, groups, loading, error, reload }}>
      {children ?? <Outlet />}
    </ContractDataContext.Provider>
  );
}

export function useContractData(): ContractDataContextValue {
  const ctx = useContext(ContractDataContext);
  if (ctx === undefined) {
    throw new Error('useContractData must be used within a ContractDataProvider');
  }
  return ctx;
}
