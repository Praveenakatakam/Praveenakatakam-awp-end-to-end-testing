import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles.css';
import App from './App.js';

/**
 * QueryClient for the new pipeline/prompt SPA pages (T-11, D-14).
 * staleTime: 30 s — pipeline and prompt data changes infrequently; avoids
 * redundant background refetches while navigating between pages.
 *
 * Existing pages (ContractData, etc.) use their own raw-fetch
 * pattern and are unaffected by this client.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
