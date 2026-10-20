/**
 * PageHeader — consistent page header component used across all pages.
 *
 * Renders an h1 title, optional subtitle, optional back link, optional badges,
 * and optional right-aligned actions. Provides visual consistency and hierarchy.
 */
import { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  back?: {
    label: string;
    to: string;
  };
  badges?: ReactNode;
  actions?: ReactNode;
}

export default function PageHeader({
  title,
  subtitle,
  back,
  badges,
  actions,
}: PageHeaderProps) {
  return (
    <header
      className="page-header"
      style={{
        paddingBottom: 16,
        marginBottom: 20,
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <div
        className="cluster"
        style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: subtitle ? 6 : 0 }}
      >
        <div style={{ flex: '1 1 280px', minWidth: 0 }}>
          {back && (
            <Link
              to={back.to}
              className="text-sm"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                marginBottom: 6,
                color: 'var(--text-muted)',
              }}
            >
              ← {back.label}
            </Link>
          )}
          <h1
            className="page-title"
            style={{
              fontSize: 20,
              fontWeight: 600,
              color: 'var(--text)',
              lineHeight: 1.3,
              margin: 0,
            }}
          >
            {title}
          </h1>
          {subtitle && (
            <p
              className="text-muted"
              style={{ fontSize: 13, marginTop: 4, marginBottom: 0 }}
            >
              {subtitle}
            </p>
          )}
        </div>
        {badges && <div className="cluster" style={{ gap: 6, flexShrink: 0 }}>{badges}</div>}
        {actions && <div className="cluster" style={{ gap: 8, flexShrink: 0 }}>{actions}</div>}
      </div>
    </header>
  );
}
