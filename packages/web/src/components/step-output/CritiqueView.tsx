/**
 * CritiqueView — a `critique` step output (R-62, R-77): verdict badge, summary,
 * and an issues table (severity, target, problem, suggestion).
 */
import type { CritiqueView as Critique } from '../../lib.js';

function verdictClass(verdict: string): string {
  switch (verdict) {
    case 'approve': return 'badge badge-success';
    case 'revise':  return 'badge badge-warning';
    case 'reject':  return 'badge badge-danger';
    default:        return 'badge badge-muted';
  }
}

function severityClass(severity: string): string {
  switch (severity) {
    case 'blocker': return 'badge badge-danger';
    case 'major':   return 'badge badge-warning';
    default:        return 'badge badge-muted';
  }
}

export default function CritiqueView({ critique }: { critique: Critique }) {
  return (
    <div aria-label="critique output">
      <div className="cluster" style={{ marginBottom: 8 }}>
        <span className="text-muted text-sm">Verdict</span>
        <span className={verdictClass(critique.verdict)} data-testid="critique-verdict">{critique.verdict}</span>
      </div>
      {critique.summary && <p className="prose">{critique.summary}</p>}

      <p className="section-heading">Issues ({critique.issues.length})</p>
      {critique.issues.length === 0 ? (
        <p className="text-muted text-sm">No issues raised.</p>
      ) : (
        <div className="table-scroll"><table className="data-table" aria-label="critique issues">
          <thead>
            <tr><th>Severity</th><th>Target</th><th>Problem</th><th>Suggestion</th></tr>
          </thead>
          <tbody>
            {critique.issues.map((issue, i) => (
              <tr key={i}>
                <td><span className={severityClass(issue.severity)}>{issue.severity}</span></td>
                <td className="mono">{issue.target}</td>
                <td>{issue.problem}</td>
                <td>{issue.suggestion}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}
