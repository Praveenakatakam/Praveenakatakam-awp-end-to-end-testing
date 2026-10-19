/**
 * AppRoutes — the testable routing unit for the registry SPA.
 *
 * Renders: AuthenticatedShell (Sidebar + Outlet) + full Routes tree.
 * No router component here — AppShell wraps this in <HashRouter>.
 * Tests wrap this in <MemoryRouter>.
 *
 * Route tree:
 *   /                                    → redirect → /source/contracts-by-entity
 *   /source/*                            → ContractDataProvider (Outlet)
 *     contracts-by-entity               → ByEntityPage
 *     contracts-by-source               → BySourcePage
 *     requirements                      → RequirementsPage
 *   /experiments[?selected=kind:id]      → ExperimentsHubPage (T-32, R-88)
 *   /experiments/prompt-versions         → redirect → /prompts   (R-87)
 *   /experiments/compare                 → redirect → /compare   (R-87)
 *   /experiments/run                     → redirect → /experiments (R-87)
 *   /pipelines                           → PipelinesPage (T-12, R-38)
 *   /pipelines/:pipelineId               → PipelinePage  (T-12, R-39)
 *   /pipelines/:pipelineId/runs/:runId   → RunDetailPage (T-14, R-54)
 *   /prompts                             → PromptsPage   (T-13, R-41)
 *   /prompts/:key                        → PromptPage    (T-13, R-43)
 *   /runs                                → RunsPage (not in nav since v0.6.0)
 *   /runs/:runId                         → RunDetailPage (experiment detail links)
 *   /runs/compare?a=&b=                  → RunsComparePage (T-23, R-70)
 *   /compare?a=kind:id&b=kind:id         → ComparePage (T-34, R-90)
 *   /*                                   → redirect → /source/contracts-by-entity
 *
 * Requirements: R-38, R-41, R-53, R-54, R-87
 * Task: T-15, T-32
 */
import { useEffect, useRef, useState } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import type { Api } from './api.js';
import Sidebar from './Sidebar.js';
import { ContractDataProvider } from './contexts/ContractDataContext.js';
import ByEntityPage from './pages/ByEntityPage.js';
import BySourcePage from './pages/BySourcePage.js';
import RequirementsPage from './pages/RequirementsPage.js';
import ExperimentsHubPage from './pages/ExperimentsHubPage.js';
import PipelinesPage from './pages/PipelinesPage.js';
import PipelinePage from './pages/PipelinePage.js';
import RunDetailPage from './pages/RunDetailPage.js';
import PromptsPage from './pages/PromptsPage.js';
import PromptPage from './pages/PromptPage.js';
import RunsPage from './pages/RunsPage.js';
import RunsComparePage from './pages/RunsComparePage.js';
import ComparePage from './pages/ComparePage.js';

function AuthenticatedShell({ token }: { token: string }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const prevOpenRef = useRef(false);

  // Focus management — move focus into sidebar on open, return to hamburger on close
  useEffect(() => {
    if (sidebarOpen) {
      prevOpenRef.current = true;
    } else if (prevOpenRef.current) {
      prevOpenRef.current = false;
      hamburgerRef.current?.focus();
    }
  }, [sidebarOpen]);

  const closeNav = () => setSidebarOpen(false);

  return (
    <div className="app-layout">
      <button
        ref={hamburgerRef}
        className="hamburger-btn"
        aria-label="Open navigation"
        aria-expanded={sidebarOpen}
        onClick={() => setSidebarOpen(true)}
      >
        ☰
      </button>

      {sidebarOpen && (
        <div
          className="sidebar-overlay-backdrop"
          onClick={closeNav}
          aria-hidden="true"
        />
      )}

      <Sidebar token={token} isOpen={sidebarOpen} onNavigate={closeNav} />

      <div className="app-main-area">
        <Outlet />
      </div>
    </div>
  );
}

export default function AppRoutes({ api, token }: { api: Api; token: string }) {
  return (
    <Routes>
      <Route path="/" element={<AuthenticatedShell token={token} />}>
        <Route index element={<Navigate to="/source/contracts-by-entity" replace />} />

        {/* Catalog routes */}
        <Route path="source" element={<ContractDataProvider api={api} />}>
          <Route path="contracts-by-entity" element={<ByEntityPage api={api} />} />
          <Route path="contracts-by-source" element={<BySourcePage api={api} />} />
          <Route path="requirements" element={<RequirementsPage api={api} />} />
        </Route>

        {/* Unified experiments (T-32, R-87, R-88) — legacy URLs redirect */}
        <Route path="experiments" element={<ExperimentsHubPage api={api} token={token} />} />
        <Route path="experiments/prompt-versions" element={<Navigate to="/prompts" replace />} />
        <Route path="experiments/compare" element={<Navigate to="/compare" replace />} />
        <Route path="experiments/run" element={<Navigate to="/experiments" replace />} />

        {/* Pipeline management (T-15, R-38, R-39) */}
        <Route path="pipelines" element={<PipelinesPage api={api} token={token} />} />
        <Route path="pipelines/:pipelineId" element={<PipelinePage api={api} token={token} />} />
        <Route path="pipelines/:pipelineId/runs/:runId" element={<RunDetailPage api={api} />} />

        {/* Prompt management (T-15, R-41, R-43, R-53) */}
        <Route path="prompts" element={<PromptsPage api={api} token={token} />} />
        <Route path="prompts/:key" element={<PromptPage api={api} token={token} />} />

        {/* Run history (T-14, R-54) */}
        <Route path="runs" element={<RunsPage api={api} />} />
        <Route path="runs/compare" element={<RunsComparePage api={api} />} />
        <Route path="runs/:runId" element={<RunDetailPage api={api} />} />

        {/* Experiment-level compare (T-34, R-90) */}
        <Route path="compare" element={<ComparePage api={api} />} />

        <Route path="*" element={<Navigate to="/source/contracts-by-entity" replace />} />
      </Route>
    </Routes>
  );
}
