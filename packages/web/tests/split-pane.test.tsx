/**
 * [web] tier — shared SplitPane (T-21 · R-68 · TS-52, TS-53).
 */
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import SplitPane from '../src/components/SplitPane.js';

const VIEWPORT = 1400;
const MAX = 980; // 70vw

/** jsdom has no layout — fake the side pane's rendered width. */
function stubSideWidth(width: number) {
  return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const w = this.classList.contains('split-pane-side') ? width : 0;
    return { width: w, height: 0, top: 0, left: 0, right: w, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
}

function renderPane(id = 'test') {
  return render(
    <SplitPane id={id} sideLabel="side">
      <div>main content</div>
      <div>side content</div>
    </SplitPane>
  );
}

const sideWidth = () => (screen.getByRole('complementary', { name: 'side' }) as HTMLElement).style.width;

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: VIEWPORT });
});
afterEach(() => vi.restoreAllMocks());

describe('SplitPane (T-21 · R-68)', () => {
  it('renders a focusable separator with a measured aria-valuenow', () => {
    stubSideWidth(500);
    renderPane();
    const sep = screen.getByRole('separator');
    expect(sep).toHaveAttribute('aria-orientation', 'vertical');
    expect(sep).toHaveAttribute('tabindex', '0');
    expect(sep).toHaveAttribute('aria-valuenow', '500');
    expect(sep).toHaveAttribute('aria-valuemin', '320');
    expect(sep).toHaveAttribute('aria-valuemax', String(MAX));
  });

  it('omits the divider and side pane when the side child is empty', () => {
    render(<SplitPane id="x">{<div>main</div>}{null}</SplitPane>);
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });

  it('TS-52: a pointer drag of −100px widens the panel by 100px from its measured width, persists, and restores on remount', () => {
    stubSideWidth(500);
    const { unmount } = renderPane('drag');
    const sep = screen.getByRole('separator');

    fireEvent.pointerDown(sep, { clientX: 800, pointerId: 1, pointerType: 'touch' });
    // First move must not jump: tiny move keeps width ≈ measured.
    fireEvent.pointerMove(sep, { clientX: 799, pointerId: 1 });
    expect(sideWidth()).toBe('501px');
    fireEvent.pointerMove(sep, { clientX: 700, pointerId: 1 });
    fireEvent.pointerUp(sep, { clientX: 700, pointerId: 1 });

    expect(sideWidth()).toBe('600px');
    expect(sep).toHaveAttribute('aria-valuenow', '600');
    expect(localStorage.getItem('pane:drag')).toBe('600');

    // Moves after pointerup are ignored.
    fireEvent.pointerMove(sep, { clientX: 100, pointerId: 1 });
    expect(sideWidth()).toBe('600px');

    unmount();
    cleanup();
    renderPane('drag');
    expect(sideWidth()).toBe('600px');
    // Persisted per pane id.
    unmount();
  });

  it('persists widths per pane id', () => {
    localStorage.setItem('pane:a', '400');
    localStorage.setItem('pane:b', '700');
    stubSideWidth(0);
    const { unmount } = renderPane('a');
    expect(sideWidth()).toBe('400px');
    unmount();
    renderPane('b');
    expect(sideWidth()).toBe('700px');
  });

  it('TS-53: ArrowLeft widens the panel, ArrowRight narrows it, clamped to 320px..70vw', () => {
    stubSideWidth(500);
    renderPane('keys');
    const sep = screen.getByRole('separator');
    sep.focus();

    fireEvent.keyDown(sep, { key: 'ArrowLeft' });
    expect(sideWidth()).toBe('516px');
    fireEvent.keyDown(sep, { key: 'ArrowRight', shiftKey: true });
    expect(sideWidth()).toBe('452px');

    // Hammer past the max — never exceeds 70vw.
    for (let i = 0; i < 100; i++) fireEvent.keyDown(sep, { key: 'ArrowLeft', shiftKey: true });
    expect(sideWidth()).toBe(`${MAX}px`);
    expect(sep).toHaveAttribute('aria-valuenow', String(MAX));

    // …and never drops below 320px.
    for (let i = 0; i < 100; i++) fireEvent.keyDown(sep, { key: 'ArrowRight', shiftKey: true });
    expect(sideWidth()).toBe('320px');
  });

  it('clamps pointer drags to the same bounds', () => {
    stubSideWidth(500);
    renderPane('clamp');
    const sep = screen.getByRole('separator');
    fireEvent.pointerDown(sep, { clientX: 800, pointerId: 2 });
    fireEvent.pointerMove(sep, { clientX: -5000, pointerId: 2 });
    expect(sideWidth()).toBe(`${MAX}px`);
    fireEvent.pointerMove(sep, { clientX: 5000, pointerId: 2 });
    expect(sideWidth()).toBe('320px');
    fireEvent.pointerUp(sep, { pointerId: 2 });
  });
});
