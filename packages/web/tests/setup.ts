import '@testing-library/jest-dom/vitest';

// Node ≥ 25 ships a native `localStorage` global that is undefined unless
// `--localstorage-file` is set; vitest's jsdom environment does not overwrite
// existing globals, so expose jsdom's Storage explicitly.
declare const jsdom: { window: Window } | undefined;
if (typeof globalThis.localStorage === 'undefined' && typeof jsdom !== 'undefined') {
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, value: jsdom.window[key] });
  }
}
