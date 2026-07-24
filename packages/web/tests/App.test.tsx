import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from '../src/App.js';

// Controllable auth + api mocks.
const authState: { token: string | undefined } = { token: undefined };
vi.mock('../src/auth.js', () => ({
  currentToken: () => Promise.resolve(authState.token),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

const fakeApi = {
  listContracts: vi.fn(),
  getContract: vi.fn(),
  getRaw: vi.fn(),
  getEntity: vi.fn(),
  listCrawls: vi.fn(),
  refresh: vi.fn(),
  listRequirements: vi.fn(),
};
vi.mock('../src/api.js', () => ({ createApi: () => fakeApi, ApiError: class {} }));

function jwt(payload: object): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}
const writerToken = jwt({ 'cognito:groups': ['writer', 'reader'], username: 'writer@demo' });
const readerToken = jwt({ 'cognito:groups': ['reader'], username: 'reader@demo' });

const entries = [
  { source: 'publisher', id: 'org', entity: 'org', currentVersion: 1, currentHash: 'h', validation: 'valid' },
  { source: 'consumer', id: 'org', entity: 'org', currentVersion: 1, currentHash: 'h', validation: 'valid' },
  { source: 'publisher', id: 'user', entity: 'user', currentVersion: 1, currentHash: 'hA', validation: 'valid' },
  { source: 'consumer', id: 'user', entity: 'user', currentVersion: 2, currentHash: 'hB', validation: 'valid' },
];

const requirements = [
  {
    source: 'publisher',
    id: 'R-01',
    text: 'The system SHALL define a contract.',
    section: 'Contract',
    earsType: 'ubiquitous',
    modality: 'SHALL',
    earsConforming: true,
    changedInLastCrawl: false,
  },
  {
    source: 'publisher',
    id: 'R-10',
    text: 'WHEN a client calls, THE API SHALL respond.',
    section: 'API',
    earsType: 'event',
    modality: 'SHALL',
    earsConforming: true,
    changedInLastCrawl: true,
  },
  {
    source: 'consumer',
    id: 'R-20',
    text: 'Before returning, it validates.',
    section: 'Ingest',
    earsType: 'ubiquitous',
    modality: null,
    earsConforming: false,
    changedInLastCrawl: false,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  authState.token = undefined;
  fakeApi.listContracts.mockResolvedValue(entries);
  fakeApi.listRequirements.mockResolvedValue(requirements);
});

describe('App auth gate + Refresh visibility (T-14 · R-60, R-64)', () => {
  it('shows the sign-in form when unauthenticated (AC-60)', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument();
  });

  it('shows Refresh for a writer (AC-64)', async () => {
    authState.token = writerToken;
    render(<App />);
    expect(await screen.findByRole('button', { name: /refresh/i })).toBeInTheDocument();
  });

  it('hides Refresh for a reader-only user (AC-64)', async () => {
    authState.token = readerToken;
    render(<App />);
    await screen.findByText('org');
    expect(screen.queryByRole('button', { name: /refresh/i })).not.toBeInTheDocument();
  });
});

describe('App browse + detail + diff (T-15 · R-61, R-62, R-63)', () => {
  beforeEach(() => {
    authState.token = readerToken;
  });

  it('groups by entity and flags divergence (AC-61)', async () => {
    render(<App />);
    await screen.findByText('org');
    expect(screen.getByText('user')).toBeInTheDocument();
    // exactly one divergent badge (user diverges, org does not)
    expect(screen.getAllByTestId('divergent')).toHaveLength(1);
  });

  it('opens a contract detail, shows its metadata, and views its YAML (AC-62)', async () => {
    fakeApi.getContract.mockResolvedValue({
      entry: { id: 'user', entity: 'user', name: 'User Contract', declaredVersion: '1.2.0', validation: 'valid', currentVersion: 1 },
      versions: [{ versionNumber: 1, hash: 'abcdef12' }],
    });
    fakeApi.getRaw.mockResolvedValue('kind: DataContract\nversion: 1.0.0\n');
    render(<App />);
    await screen.findByText('org');
    await userEvent.click(screen.getAllByRole('button', { name: /publisher v/i })[0]);
    // Metadata block renders the entry's fields (R-62), not just the id heading.
    const meta = await screen.findByLabelText('metadata');
    expect(meta).toHaveTextContent('User Contract');
    expect(meta).toHaveTextContent('1.2.0');
    expect(meta).toHaveTextContent('valid');
    await userEvent.click(await screen.findByRole('button', { name: /view yaml/i }));
    expect(await screen.findByLabelText('yaml')).toHaveTextContent('DataContract');
  });

  it('shows a per-property diff for a divergent entity (AC-63)', async () => {
    fakeApi.getEntity.mockResolvedValue({
      entity: 'user',
      divergent: true,
      diff: {
        onlyInA: [{ path: 'user.password' }],
        onlyInB: [{ path: 'user.middleName' }],
        changed: [{ path: 'user.email', field: 'required' }],
      },
    });
    render(<App />);
    await screen.findByText('user');
    await userEvent.click(screen.getByRole('button', { name: /show user diff/i }));
    const diff = await screen.findByLabelText('diff');
    expect(diff).toHaveTextContent('user.middleName');
    expect(diff).toHaveTextContent('user.email.required');
  });
});

describe('App by-source view toggle (T-17 · R-65)', () => {
  beforeEach(() => {
    authState.token = readerToken;
  });

  it('defaults to the by-entity view; no by-source list until toggled (AC-61/AC-65)', async () => {
    render(<App />);
    await screen.findByText('org');
    expect(screen.queryByLabelText('by-source')).not.toBeInTheDocument();
  });

  it('toggles to a by-source view listing each source and its contracts (AC-65)', async () => {
    render(<App />);
    await screen.findByText('org');
    await userEvent.click(screen.getByRole('button', { name: /^by source$/i }));

    const sourceView = await screen.findByLabelText('by-source');
    // every crawled source is listed as its own group
    expect(within(sourceView).getByRole('heading', { name: 'publisher' })).toBeInTheDocument();
    expect(within(sourceView).getByRole('heading', { name: 'consumer' })).toBeInTheDocument();
    // org is associated with BOTH sources, so it appears once under each (that is the view's point)
    expect(within(sourceView).getAllByRole('button', { name: /org v1 \(valid\)/i })).toHaveLength(2);
    // the diverged variants show their own source-specific version rows
    expect(within(sourceView).getByRole('button', { name: /user v1 \(valid\)/i })).toBeInTheDocument(); // publisher
    expect(within(sourceView).getByRole('button', { name: /user v2 \(valid\)/i })).toBeInTheDocument(); // consumer
  });

  it('opens the shared detail panel when a by-source row is selected (AC-65 → AC-62)', async () => {
    fakeApi.getContract.mockResolvedValue({ entry: { id: 'user' }, versions: [{ versionNumber: 2, hash: 'abcdef12' }] });
    render(<App />);
    await screen.findByText('org');
    await userEvent.click(screen.getByRole('button', { name: /^by source$/i }));
    const sourceView = await screen.findByLabelText('by-source');
    // consumer/user is currentVersion 2 in the fixture
    await userEvent.click(within(sourceView).getByRole('button', { name: /user v2 \(valid\)/i }));
    expect(await screen.findByRole('heading', { name: /consumer \/ user/i })).toBeInTheDocument();
  });
});

describe('App Requirements view (T-31 · R-113)', () => {
  beforeEach(() => {
    authState.token = readerToken;
  });

  it('toggles to a Requirements view grouped by source and section, badging non-conforming + changed (AC-113)', async () => {
    render(<App />);
    await screen.findByText('org');
    expect(screen.queryByLabelText('requirements')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^requirements$/i }));
    const view = await screen.findByLabelText('requirements');

    // grouped by source + section
    expect(within(view).getByRole('heading', { name: 'publisher' })).toBeInTheDocument();
    expect(within(view).getByRole('heading', { name: 'Contract' })).toBeInTheDocument();
    expect(within(view).getByRole('heading', { name: 'API' })).toBeInTheDocument();
    // requirement text is shown
    expect(within(view).getByText(/The system SHALL define a contract/)).toBeInTheDocument();
    // the non-conforming (no-modality) requirement and the changed one are badged
    expect(within(view).getByTestId('non-conforming')).toBeInTheDocument();
    expect(within(view).getByTestId('changed')).toBeInTheDocument();
  });

  it('opens a requirement detail panel when a requirement is selected (AC-113)', async () => {
    render(<App />);
    await screen.findByText('org');
    await userEvent.click(screen.getByRole('button', { name: /^requirements$/i }));
    const view = await screen.findByLabelText('requirements');
    await userEvent.click(within(view).getByRole('button', { name: /R-10/i }));
    const detail = await screen.findByLabelText('requirement-detail');
    expect(within(detail).getByRole('heading', { name: /publisher \/ R-10/i })).toBeInTheDocument();
  });
});
