import React, { useState } from 'react';
import { CheckCircle, AlertCircle, TrendingUp, TrendingDown, Zap } from 'lucide-react';

interface Finding {
  id: string;
  severity: 'Critical' | 'Major' | 'Minor';
  target: string;
  defect: string;
  verification?: { verdict: 'CONFIRMED' | 'REFUTED' | 'UNCLEAR' | 'NOT VERIFIED' };
}

interface ReviewRun {
  name: string;
  approach: 'Chain (Pass 2→3)' | 'Combined (2+3)';
  verdict: string;
  findings: number;
  major: number;
  minor: number;
  confirmed: number;
  unclear: number;
  refuted: number;
  blindItemsCovered: number;
  blindItemsTotal: number;
  citationsNotFound: number;
  passDetails: string[];
  pros: string[];
  cons: string[];
  findings_list: Finding[];
}

const runs: ReviewRun[] = [
  {
    name: '20261022-0953_test_main',
    approach: 'Chain (Pass 2→3)',
    verdict: 'FAIL — Major',
    findings: 10,
    major: 2,
    minor: 8,
    confirmed: 7,
    unclear: 3,
    refuted: 0,
    blindItemsCovered: 93,
    blindItemsTotal: 96,
    citationsNotFound: 0,
    passDetails: [
      'Pass 1: 96 expected behaviours',
      'Pass 2: 10 findings identified',
      'Pass 3: Independent verification',
      'Separate agent invocations',
    ],
    pros: [
      '✓ Comprehensive coverage – found 10 findings vs 5',
      '✓ Catches critical tier mismatch bug (F-03) that breaks entire CLI',
      '✓ Identifies 7 confirmed runtime defects (pollUntil, skip reasons, URL concat, etc.)',
      '✓ Zero citation audit issues – cleaner evidence reporting',
      '✓ Covers 3 uncovered blind items explicitly in decision items',
      '✓ Independent Pass 3 verification strengthens finding confidence',
      '✓ Better for thorough pre-deployment reviews',
    ],
    cons: [
      '✗ Slower execution (3 sequential agent passes)',
      '✗ Higher token usage (~700k tokens vs ~300k)',
      '✗ More complex orchestration with 3 decision points',
      '✗ Longer feedback loop for reviewers',
    ],
    findings_list: [
      { id: 'F-01', severity: 'Major', target: 'manifest.json:101', defect: 'Unmapped TaskPublished path /api/create/review/advance', verification: { verdict: 'UNCLEAR' } },
      { id: 'F-02', severity: 'Major', target: 'manifest.json:669', defect: 'Unmapped TaskPublished path /api/create/tasks/publish', verification: { verdict: 'UNCLEAR' } },
      { id: 'F-03', severity: 'Major', target: 'mutate-testgen.ts:69', defect: 'Oracle tier mismatch aborts entire CLI run', verification: { verdict: 'CONFIRMED' } },
      { id: 'F-04', severity: 'Minor', target: 'mutate-testgen.ts:92', defect: 'Nested mutants never generated', verification: { verdict: 'CONFIRMED' } },
      { id: 'F-05', severity: 'Minor', target: 'emit.ts:72', defect: 'logicalType case-sensitivity mismatch', verification: { verdict: 'UNCLEAR' } },
      { id: 'F-06', severity: 'Minor', target: 'emit.ts:152', defect: 'pollUntil misses final interval', verification: { verdict: 'CONFIRMED' } },
      { id: 'F-07', severity: 'Minor', target: 'emit.ts:154', defect: 'Non-ok responses swallowed as timeout', verification: { verdict: 'CONFIRMED' } },
      { id: 'F-08', severity: 'Minor', target: 'ground.ts:127', defect: 'Skip reason misleading fallback', verification: { verdict: 'CONFIRMED' } },
      { id: 'F-09', severity: 'Minor', target: 'emit.ts:44', defect: 'Double-slash in base-URL/path concat', verification: { verdict: 'CONFIRMED' } },
      { id: 'F-10', severity: 'Minor', target: 'generate.ts:115', defect: 'Conformance file path non-unique', verification: { verdict: 'CONFIRMED' } },
    ],
  },
  {
    name: '20261022-1038_test-update_main',
    approach: 'Combined (2+3)',
    verdict: 'FAIL — Major',
    findings: 5,
    major: 2,
    minor: 3,
    confirmed: 3,
    unclear: 2,
    refuted: 0,
    blindItemsCovered: 91,
    blindItemsTotal: 93,
    citationsNotFound: 24,
    passDetails: [
      'Pass 1: 93 expected behaviours',
      'Pass 2+3: Combined reconcile & verify',
      'Single agent execution',
    ],
    pros: [
      '✓ Faster execution (single combined pass)',
      '✓ Lower token usage (~300k vs ~700k)',
      '✓ Simpler orchestration – one agent to manage',
      '✓ Good for fast-turnaround reviews',
      '✓ Still catches both Major issues (F-01, F-02)',
      '✓ 3 findings confirmed immediately',
    ],
    cons: [
      '✗ Misses critical tier-mismatch bug (F-03)',
      '✗ Only 5 findings vs 10 – incomplete coverage',
      '✗ Skips several confirmed runtime defects',
      '✗ 24 citations not found – evidence reporting issues',
      '✗ Fewer uncovered blind items flagged',
      '✗ More vulnerable to single-pass blind spots',
      '✗ Less suitable for critical production reviews',
    ],
    findings_list: [
      { id: 'F-01', severity: 'Major', target: 'manifest.json:101', defect: 'Unmapped TaskPublished path /api/create/review/advance', verification: { verdict: 'UNCLEAR' } },
      { id: 'F-02', severity: 'Major', target: 'manifest.json:669', defect: 'Unmapped TaskPublished path /api/create/tasks/publish', verification: { verdict: 'UNCLEAR' } },
      { id: 'F-03', severity: 'Minor', target: 'emit.ts:108', defect: 'envStem digit-leading identifier syntax error', verification: { verdict: 'CONFIRMED' } },
      { id: 'F-04', severity: 'Minor', target: 'derive-schema.ts:62', defect: 'KNOWN_FORMATS subset drop', verification: { verdict: 'CONFIRMED' } },
      { id: 'F-05', severity: 'Minor', target: 'generate.ts:115', defect: 'Conformance file path non-unique', verification: { verdict: 'CONFIRMED' } },
    ],
  },
];

const SeverityBadge = ({ severity }: { severity: string }) => {
  const colors = {
    Critical: 'bg-red-900 text-red-50',
    Major: 'bg-orange-700 text-orange-50',
    Minor: 'bg-yellow-600 text-yellow-50',
  };
  return (
    <span className={`px-2 py-1 rounded text-sm font-medium ${colors[severity as keyof typeof colors]}`}>
      {severity}
    </span>
  );
};

const VerdictBadge = ({ verdict }: { verdict: string }) => {
  const isConfirmed = verdict === 'CONFIRMED';
  return (
    <span className={`px-2 py-1 rounded text-xs font-semibold ${
      isConfirmed ? 'bg-green-900 text-green-50' : 'bg-amber-900 text-amber-50'
    }`}>
      {verdict}
    </span>
  );
};

export default function AdversarialReviewComparison() {
  const [selectedFinding, setSelectedFinding] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-slate-100 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
            Adversarial Review: Chain vs. Combined
          </h1>
          <p className="text-slate-400">
            Comparing Pass 2→Pass 3 (separate agents) with experimental Pass 2+3 (combined)
          </p>
        </div>

        {/* Verdict Comparison */}
        <div className="grid grid-cols-2 gap-6 mb-8">
          {runs.map((run) => (
            <div key={run.name} className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 backdrop-blur">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-xl font-bold text-cyan-300">{run.approach}</h2>
                  <p className="text-sm text-slate-500">{run.name}</p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-red-400">{run.verdict}</div>
                </div>
              </div>

              {/* Key Metrics */}
              <div className="grid grid-cols-2 gap-3 mb-4 pb-4 border-b border-slate-700">
                <div>
                  <div className="text-3xl font-bold text-orange-400">{run.findings}</div>
                  <div className="text-xs text-slate-400">Total Findings</div>
                </div>
                <div>
                  <div className="text-3xl font-bold text-green-400">{run.confirmed}</div>
                  <div className="text-xs text-slate-400">Confirmed</div>
                </div>
                <div>
                  <div className="text-lg font-semibold text-orange-300">{run.major} Major</div>
                  <div className="text-xs text-slate-400">{run.minor} Minor</div>
                </div>
                <div>
                  <div className="text-lg font-semibold text-amber-300">{run.blindItemsCovered}/{ run.blindItemsTotal}</div>
                  <div className="text-xs text-slate-400">Blind Items</div>
                </div>
              </div>

              {/* Pass Details */}
              <div className="space-y-1 mb-4 pb-4 border-b border-slate-700">
                {run.passDetails.map((detail, i) => (
                  <div key={i} className="text-sm text-slate-400 flex items-center">
                    <span className="w-1.5 h-1.5 bg-cyan-500 rounded-full mr-2"></span>
                    {detail}
                  </div>
                ))}
              </div>

              {/* Citation Audit */}
              {run.citationsNotFound > 0 && (
                <div className="bg-amber-950/40 border border-amber-900 rounded p-3 text-sm text-amber-200">
                  <AlertCircle className="inline w-4 h-4 mr-2" />
                  {run.citationsNotFound} citations not verified
                </div>
              )}
              {run.citationsNotFound === 0 && (
                <div className="bg-green-950/40 border border-green-900 rounded p-3 text-sm text-green-200">
                  <CheckCircle className="inline w-4 h-4 mr-2" />
                  All citations verified
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Pros & Cons */}
        <div className="grid grid-cols-2 gap-6 mb-8">
          {runs.map((run) => (
            <div key={`pros-${run.name}`} className="space-y-4">
              <div className="bg-green-950/20 border border-green-800 rounded-lg p-6 backdrop-blur">
                <h3 className="text-lg font-bold text-green-400 mb-4 flex items-center">
                  <TrendingUp className="w-5 h-5 mr-2" />
                  Strengths
                </h3>
                <ul className="space-y-2">
                  {run.pros.map((pro, i) => (
                    <li key={i} className="text-sm text-green-200 leading-relaxed">
                      {pro}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="bg-red-950/20 border border-red-800 rounded-lg p-6 backdrop-blur">
                <h3 className="text-lg font-bold text-red-400 mb-4 flex items-center">
                  <TrendingDown className="w-5 h-5 mr-2" />
                  Weaknesses
                </h3>
                <ul className="space-y-2">
                  {run.cons.map((con, i) => (
                    <li key={i} className="text-sm text-red-200 leading-relaxed">
                      {con}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>

        {/* Findings Comparison Table */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 backdrop-blur mb-8">
          <h3 className="text-lg font-bold text-cyan-300 mb-4 flex items-center">
            <Zap className="w-5 h-5 mr-2" />
            Findings Comparison
          </h3>

          <div className="grid grid-cols-2 gap-6">
            {runs.map((run) => (
              <div key={`findings-${run.name}`}>
                <h4 className="text-sm font-semibold text-slate-300 mb-3">{run.approach}</h4>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {run.findings_list.map((finding) => (
                    <div
                      key={finding.id}
                      onClick={() => setSelectedFinding(selectedFinding === finding.id ? null : finding.id)}
                      className="bg-slate-700/30 border border-slate-600 rounded p-3 cursor-pointer hover:border-cyan-500 transition-colors group"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-bold text-cyan-400">{finding.id}</span>
                            <SeverityBadge severity={finding.severity} />
                          </div>
                          <p className="text-xs text-slate-400 line-clamp-2 group-hover:text-slate-300">
                            {finding.defect}
                          </p>
                        </div>
                        {finding.verification && (
                          <VerdictBadge verdict={finding.verification.verdict} />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recommendation */}
        <div className="bg-gradient-to-r from-cyan-900/30 to-blue-900/30 border border-cyan-700 rounded-lg p-6 backdrop-blur">
          <h3 className="text-lg font-bold text-cyan-300 mb-3">Recommendation</h3>
          <p className="text-slate-300 mb-4">
            <strong className="text-cyan-400">For production/critical reviews:</strong> Use the <strong>Chain approach (Pass 2→3)</strong>.
            It finds 2× the defects, catches the critical tier-mismatch bug (F-03), confirms 7 runtime issues,
            and provides cleaner evidence. The extra latency is worth the thoroughness.
          </p>
          <p className="text-slate-300">
            <strong className="text-cyan-400">For fast iteration/CI feedback:</strong> The <strong>Combined approach</strong>
            is viable as a first-pass screen, but should not be your final gate. It misses the CLI abort bug and
            several confirmed defects that users would encounter in production.
          </p>
        </div>
      </div>
    </div>
  );
}
