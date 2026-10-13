/**
 * AppRoutes — the testable routing unit for the registry SPA.
 *
 * Renders: AuthenticatedShell (Sidebar + Outlet) + full Routes tree.
 * No router component here — AppShell wraps this in <HashRouter>.
 * Tests wrap this in <MemoryRouter>.
 *
 * Route tree:
 *   /                        → redirect → /source/contracts-by-entity
 *   /source/*                → ContractDataProvider (Outlet)
 *     contracts-by-entity    → ByEntityPage
 *     contracts-by-source    → BySourcePage
 *     requirements           → RequirementsPage
 *   /experiments/*           → ExperimentsPage (URL-based sub-views internally)
 *   /*                       → redirect → /source/contracts-by-entity
 */
import { useEffect, useRef, useState } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import type { Api } from './api.js';
import Sidebar from './Sidebar.js';
import { ContractDataProvider } from './contexts/ContractDataContext.js';
import ByEntityPage from './pages/ByEntityPage.js';
import BySourcePage from './pages/BySourcePage.js';
import RequirementsPage from './pages/RequirementsPage.js';
import ExperimentsPage from './pages/ExperimentsPage.js';

function AuthenticatedShell({ token }: { token: string }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const prevOpenRef = useRef(false);

  // R-23: focus management — move focus into sidebar on open, return to hamburger on close
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
        <Route path="source" element={<ContractDataProvider api={api} />}>
          <Route path="contracts-by-entity" element={<ByEntityPage api={api} />} />
          <Route path="contracts-by-source" element={<BySourcePage api={api} />} />
          <Route path="requirements" element={<RequirementsPage api={api} />} />
        </Route>
        <Route path="experiments/*" element={<ExperimentsPage api={api} token={token} />} />
        <Route path="*" element={<Navigate to="/source/contracts-by-entity" replace />} />
      </Route>
    </Routes>
  );
}
