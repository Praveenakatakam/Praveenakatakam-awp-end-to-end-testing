/**
 * T-AR-10a — Adversarial tab integration in App (4 tests).
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from '../src/App.js';

const authState: { token: string | undefined } = { token: undefined };
vi.mock('../src/auth.js', () => ({
  currentToken: () => Promise.resolve(authState.token),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

const fakeApi = {
  listContracts: vi.fn().mockResolvedValue([]),
  getContract: vi.fn(),
  getRaw: vi.fn(),
  getEntity: vi.fn(),
  listCrawls: vi.fn(),
  refresh: vi.fn(),
  listRequirements: vi.fn().mockResolvedValue([]),
  listAdversarialRuns: vi.fn().mockResolvedValue([]),
  getAdversarialFindings: vi.fn(),
};
vi.mock('../src/api.js', () => ({ createApi: () => fakeApi, ApiError: class {} }));

function jwt(payload: object): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}
const readerToken = jwt({ 'cognito:groups': ['reader'], username: 'reader@demo' });

beforeEach(() => {
  authState.token = readerToken;
  vi.clearAllMocks();
  fakeApi.listContracts.mockResolvedValue([]);
  fakeApi.listRequirements.mockResolvedValue([]);
  fakeApi.listAdversarialRuns.mockResolvedValue([]);
});

describe('App adversarial tab (T-AR-10a)', () => {
  it('(a) Adversarial nav button is visible in the navigation', async () => {
    render(<App />);
    await waitFor(() => screen.getByRole('navigation', { name: 'view toggle' }));
    expect(screen.getByRole('button', { name: 'Adversarial' })).toBeInTheDocument();
  });

  it('(b) clicking Adversarial switches view and shows sub-tabs', async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => screen.getByRole('button', { name: 'Adversarial' }));
    await user.click(screen.getByRole('button', { name: 'Adversarial' }));
    expect(screen.getByRole('navigation', { name: 'review kind' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test review' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Code review' })).toBeInTheDocument();
  });

  it('(c) AdversarialView loads runs on mount', async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => screen.getByRole('button', { name: 'Adversarial' }));
    await user.click(screen.getByRole('button', { name: 'Adversarial' }));
    await waitFor(() => expect(fakeApi.listAdversarialRuns).toHaveBeenCalledWith('test'));
  });

  it('(d) Adversarial button has aria-pressed=true when active', async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => screen.getByRole('button', { name: 'Adversarial' }));
    const btn = screen.getByRole('button', { name: 'Adversarial' });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    await user.click(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });
});
