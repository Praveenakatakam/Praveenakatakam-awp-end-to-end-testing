/**
 * Sidebar — persistent left-rail navigation for the registry SPA.
 *
 * Renders (R-69):
 *   data-area="catalog"     — Catalog nav links + Refresh action
 *   data-area="experiments" — Experiments, Pipelines, Prompts, Compare (R-87);
 *                             the v0.4.0 Legacy group is gone — its URLs redirect
 *
 * Each area group is wrapped in its own <nav> landmark.
 * Active links carry aria-current="page".
 * Refresh button is a <button>, not a nav link.
 *
 * Requirements: R-38, R-41, R-53, R-54, R-69, R-87
 * Task: T-15, T-22, T-32
 */
import { useEffect, useRef } from 'react';
import * as NavigationMenu from '@radix-ui/react-navigation-menu';
import { NavLink, useMatch } from 'react-router-dom';
import { CrawlLog } from './CrawlLog.js';
import { useCrawl } from './contexts/CrawlContext.js';
import { isWriter } from './lib.js';

interface NavItemProps {
  to: string;
  label: string;
  onNavigate?: () => void;
}

function SidebarNavItem({ to, label, onNavigate }: NavItemProps) {
  const active = !!useMatch(to);
  return (
    <NavigationMenu.Item>
      <NavigationMenu.Link asChild active={active}>
        <NavLink to={to} aria-current={active ? 'page' : undefined} onClick={onNavigate}>
          {label}
        </NavLink>
      </NavigationMenu.Link>
    </NavigationMenu.Item>
  );
}

interface SidebarProps {
  token: string;
  isOpen?: boolean;
  onNavigate?: () => void;
}

export default function Sidebar({ token, isOpen, onNavigate }: SidebarProps) {
  const { crawlRunning, crawlElapsed, crawlSummary, crawlError, runRefresh } = useCrawl();
  const writer = isWriter(token);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Move focus into sidebar when it opens on mobile
  useEffect(() => {
    if (isOpen) {
      sidebarRef.current?.focus();
    }
  }, [isOpen]);

  // Dismiss on Escape key while sidebar is open (mobile overlay)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && isOpen) {
      onNavigate?.();
    }
  };

  return (
    <div
      ref={sidebarRef}
      className={`sidebar${isOpen ? ' sidebar-open' : ''}`}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      {/* Catalog area (R-69) */}
      <div className="sidebar-area" data-area="catalog">
        <nav aria-label="Catalog navigation">
          <div className="sidebar-area-header">
            <span className="sidebar-area-title">Requirements Catalog</span>
            {writer && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={runRefresh}
                disabled={crawlRunning}
                aria-label="Refresh crawl"
                title="Re-crawl contracts and requirements"
              >
                ↺
              </button>
            )}
          </div>
          {crawlRunning && (
            <span className="badge badge-accent badge-pulse">
              Crawling… {crawlElapsed.toFixed(1)}s
            </span>
          )}
          {crawlError && (
            <span className="badge badge-danger">Refresh failed</span>
          )}
          {crawlSummary && <CrawlLog summary={crawlSummary} />}
          <NavigationMenu.Root orientation="vertical">
            <NavigationMenu.List>
              <SidebarNavItem to="/source/contracts-by-entity" label="Contracts by entity" onNavigate={onNavigate} />
              <SidebarNavItem to="/source/contracts-by-source" label="Contracts by source" onNavigate={onNavigate} />
              <SidebarNavItem to="/source/requirements" label="Requirements" onNavigate={onNavigate} />
            </NavigationMenu.List>
          </NavigationMenu.Root>
        </nav>
      </div>

      {/* Experiments area (R-87) — unified pipeline + legacy experimentation */}
      <div className="sidebar-area" data-area="experiments">
        <nav aria-label="Experiments navigation">
          <div className="sidebar-area-header">
            <span className="sidebar-area-title">Experiments</span>
          </div>
          <NavigationMenu.Root orientation="vertical">
            <NavigationMenu.List>
              <SidebarNavItem to="/prompts" label="Prompts" onNavigate={onNavigate} />
              <SidebarNavItem to="/pipelines" label="Pipelines" onNavigate={onNavigate} />
              <SidebarNavItem to="/experiments" label="Experiments" onNavigate={onNavigate} />
              <SidebarNavItem to="/compare" label="Compare" onNavigate={onNavigate} />
            </NavigationMenu.List>
          </NavigationMenu.Root>
        </nav>
      </div>
    </div>
  );
}
