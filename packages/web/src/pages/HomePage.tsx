/**
 * HomePage — landing page: what the registry is for, how its two areas fit
 * together, and a short quick start. Route: / (index).
 */
import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader.js';

interface FlowNode {
  title: string;
  detail: string;
  to?: string;
}

const CATALOG_FLOW: FlowNode[] = [
  { title: 'Source repos', detail: 'GitHub repos for each service' },
  { title: 'Crawl', detail: 'Refresh pulls ODCS contracts + EARS requirements' },
  { title: 'Catalog', detail: 'Validated, versioned contracts and requirements', to: '/source/contracts-by-entity' },
];

const EXPERIMENT_FLOW: FlowNode[] = [
  { title: 'Pipeline', detail: 'Ordered LLM steps — model + prompt each', to: '/pipelines' },
  { title: 'Experiment', detail: 'Run it on sampled, grounded requirements', to: '/experiments' },
  { title: 'Results', detail: 'A test plan + generated test per requirement' },
  { title: 'Compare', detail: 'Two experiments, requirement by requirement', to: '/compare' },
];

function Flow({ nodes, area }: { nodes: FlowNode[]; area: 'catalog' | 'experiments' }) {
  return (
    <ol className={`home-flow home-flow-${area}`}>
      {nodes.map((n) => (
        <li key={n.title} className="home-flow-node">
          {n.to ? (
            <Link to={n.to} className="home-flow-box">
              <span className="home-flow-title">{n.title}</span>
              <span className="home-flow-detail">{n.detail}</span>
            </Link>
          ) : (
            <div className="home-flow-box">
              <span className="home-flow-title">{n.title}</span>
              <span className="home-flow-detail">{n.detail}</span>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

const QUICK_START: { title: string; body: string; to: string; link: string }[] = [
  {
    title: 'Browse the catalog',
    body: 'See every contract grouped by entity or by source, and the requirements each service has written. Writers can re-crawl with the ↺ button in the sidebar.',
    to: '/source/contracts-by-entity',
    link: 'Contracts by entity',
  },
  {
    title: 'Set up a pipeline',
    body: 'A pipeline is an ordered list of steps; each step picks a model, a stored prompt, and what it returns (a plan, a critique, or free text). "Baseline (legacy v1)" reproduces the original single-step generator.',
    to: '/pipelines',
    link: 'Pipelines',
  },
  {
    title: 'Run an experiment',
    body: 'Choose New experiment, pick a pipeline, and do a dry run first: it shows which requirements will run and which are skipped because they can’t be grounded. Confirm to start.',
    to: '/experiments',
    link: 'Experiments',
  },
  {
    title: 'Inspect a run',
    body: 'Open a run to see each step’s rendered output, the exact input the model was given, what changed from the previous plan, metrics, and the generated test file.',
    to: '/experiments',
    link: 'Experiments',
  },
  {
    title: 'Compare',
    body: 'Pick any two experiments — pipeline or legacy — to see their plans and generated tests side by side for every requirement they share.',
    to: '/compare',
    link: 'Compare',
  },
];

const CONCEPTS: { term: string; body: string }[] = [
  {
    term: 'Grounded requirement',
    body: 'One that names a cataloged entity which exists in two or more services and has a live API. Only grounded requirements can produce a cross-service test; the rest are skipped with a reason.',
  },
  {
    term: 'Experiment vs run',
    body: 'One press of Run is an experiment. It creates one run per sampled requirement, and each run goes through every step of the pipeline.',
  },
  {
    term: 'Prompts',
    body: 'Stored, versioned system prompts. Editing a prompt creates a new version, so earlier results stay attributable to the text they used.',
  },
  {
    term: 'Legacy',
    body: 'Prompt-version experiments from before pipelines. They’re read-only here and can be compared with pipeline experiments.',
  },
];

export default function HomePage() {
  return (
    <div className="app-body" aria-label="home">
      <div className="app-main">
        <PageHeader
          title="E2E Testing Registry"
          subtitle="Turns each service’s data contracts and requirements into cross-service end-to-end tests — and lets you experiment with the LLM steps that write them."
        />

        <section aria-labelledby="home-how" className="home-section">
          <h2 id="home-how" className="section-title" style={{ marginTop: 0 }}>How it fits together</h2>
          <div className="home-diagram" aria-label="how the two areas fit together">
            <div className="home-lane home-lane-catalog">
              <p className="home-lane-label">Requirements Catalog</p>
              <p className="home-lane-sub">What the services promise</p>
              <Flow nodes={CATALOG_FLOW} area="catalog" />
            </div>
            <div className="home-bridge" aria-hidden="true">
              <span className="home-bridge-arrow">↓</span>
              <span className="home-bridge-label">grounded requirements + contract schemas feed every step</span>
            </div>
            <div className="home-lane home-lane-experiments">
              <p className="home-lane-label">Experiments</p>
              <p className="home-lane-sub">How tests get written — and how well</p>
              <Flow nodes={EXPERIMENT_FLOW} area="experiments" />
            </div>
          </div>
        </section>

        <section aria-labelledby="home-start" className="home-section">
          <h2 id="home-start" className="section-title">Quick start</h2>
          <ol className="home-steps">
            {QUICK_START.map((s, i) => (
              <li key={s.title} className="card home-step">
                <span className="home-step-num" aria-hidden="true">{i + 1}</span>
                <div>
                  <p className="home-step-title">{s.title}</p>
                  <p className="home-step-body">{s.body}</p>
                  <Link to={s.to} className="home-step-link">Go to {s.link} →</Link>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="home-concepts" className="home-section">
          <h2 id="home-concepts" className="section-title">Key ideas</h2>
          <dl className="home-concepts">
            {CONCEPTS.map((c) => (
              <div key={c.term} className="card home-concept">
                <dt className="home-step-title">{c.term}</dt>
                <dd className="home-step-body">{c.body}</dd>
              </div>
            ))}
          </dl>
          <p className="text-muted text-sm" style={{ marginTop: 12 }}>
            Creating, editing and running things needs the writer role; everyone signed in can browse.
          </p>
        </section>
      </div>
    </div>
  );
}
