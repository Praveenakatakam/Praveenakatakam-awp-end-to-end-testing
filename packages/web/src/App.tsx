/**
 * App — thin re-export of AppShell.
 *
 * All logic has moved to AppShell.tsx (auth gate, theme, HashRouter, routing).
 * This file is kept so existing imports from './App.js' in main.tsx continue to work.
 */
export { default } from './AppShell.js';
