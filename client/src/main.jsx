import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.jsx';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Audit logs are append-only history: a page of results does not change
      // under you, so refetching on every window focus is pure noise.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      // A 400 means the request itself is wrong; retrying it three times just
      // delays the error the user needs to see.
      retry: (failureCount, error) =>
        error?.status >= 400 && error?.status < 500 ? false : failureCount < 2,
      // Keeps the previous page rendered while the next one loads, so the table
      // does not collapse to a spinner on every sort or page change.
      placeholderData: (previous) => previous,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
