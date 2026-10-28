import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignIn } from '../src/SignIn.js';

vi.mock('../src/auth.js', () => ({
  signIn: vi.fn(),
}));

import { signIn } from '../src/auth.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SignIn (T-01a · R-60)', () => {
  it('renders the username input, password input, and submit button', () => {
    // GIVEN
    const onToken = vi.fn();
    // WHEN
    render(<SignIn onToken={onToken} />);
    // THEN
    expect(screen.getByRole('textbox', { name: /username/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('calls onToken with the returned token when signIn resolves', async () => {
    // GIVEN
    const onToken = vi.fn();
    vi.mocked(signIn).mockResolvedValue('tok-abc123');
    render(<SignIn onToken={onToken} />);
    // WHEN
    await userEvent.type(screen.getByRole('textbox', { name: /username/i }), 'alice');
    await userEvent.type(screen.getByLabelText(/password/i), 's3cr3t');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    // THEN
    expect(onToken).toHaveBeenCalledOnce();
    expect(onToken).toHaveBeenCalledWith('tok-abc123');
  });

  it('shows an error alert when signIn rejects', async () => {
    // GIVEN
    const onToken = vi.fn();
    vi.mocked(signIn).mockRejectedValue(new Error('Incorrect username or password.'));
    render(<SignIn onToken={onToken} />);
    // WHEN
    await userEvent.type(screen.getByRole('textbox', { name: /username/i }), 'alice');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    // THEN
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect username or password.');
  });

  it('does not call onToken when signIn rejects', async () => {
    // GIVEN
    const onToken = vi.fn();
    vi.mocked(signIn).mockRejectedValue(new Error('Network error'));
    render(<SignIn onToken={onToken} />);
    // WHEN
    await userEvent.type(screen.getByRole('textbox', { name: /username/i }), 'alice');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    // THEN
    await screen.findByRole('alert');
    expect(onToken).not.toHaveBeenCalled();
  });
});
