import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SSEProvider } from "./providers/SSEProvider.tsx";
import { ToastProvider } from "./components/shared/ToastProvider.tsx";
import { ErrorBoundary } from "./components/shared/ErrorBoundary.tsx";
import { App } from "./App.tsx";
import "leaflet/dist/leaflet.css";
import "./index.css";

/**
 * QueryClient configuration:
 *   - staleTime 30s: SSE events trigger targeted invalidation, so we don't
 *     need aggressive refetching. This prevents redundant network requests.
 *   - retry 2: resilient to transient API failures during cold-start.
 *   - refetchOnWindowFocus: disabled because SSE keeps us in sync.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <SSEProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </SSEProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
