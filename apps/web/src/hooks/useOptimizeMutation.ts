/**
 * useOptimizeMutation -- TanStack mutation for route optimization.
 *
 * Flow:
 *   1. User clicks "Optimize" on a vehicle column
 *   2. onMutate: set spinner via Zustand `setOptimizing(vehicleId, true)`
 *   3. mutationFn: POST /api/optimize { vehicleId }
 *   4. Backend enqueues the job on Redis Streams
 *   5. Worker picks it up, computes the optimal route, writes result
 *   6. Backend broadcasts SSE `route_optimized` event
 *   7. SSEProvider catches it → clears spinner + invalidates cache
 *
 * Why the spinner is managed in Zustand (not React Query):
 *   The spinner must persist ACROSS the mutation lifecycle.
 *   The mutation resolves as soon as the API acknowledges the request
 *   (step 4), but the actual optimization finishes asynchronously
 *   (step 6). Zustand holds the "optimizing" flag until the SSE
 *   event arrives -- a span that React Query's `isPending` can't cover.
 *
 * DRY: This is the ONLY place that calls api.optimize(). Every
 * component that needs optimization goes through this hook.
 */

import { useMutation } from "@tanstack/react-query";
import type { OptimizeRequest } from "@repo/shared";
import { api, ApiError } from "../lib/api.ts";
import { useUIStore } from "../stores/ui.store.ts";
import { useToastStore } from "../stores/toast.store.ts";

export function useOptimizeMutation() {
  const setOptimizing = useUIStore((s) => s.setOptimizing);
  const addToast = useToastStore((s) => s.addToast);

  return useMutation({
    mutationFn: (request: OptimizeRequest) => api.optimize(request),

    onMutate: (request) => {
      // Immediately show spinner -- it will be cleared by SSEProvider
      // when the `route_optimized` event arrives.
      setOptimizing(request.vehicleId, true);
    },

    onSuccess: () => {
      // Note: spinner stays visible until SSE `route_optimized` arrives.
      // This toast confirms the request was accepted (enqueued).
      addToast({
        variant: "info",
        title: "Optimization started",
        description: "Route optimization is running in background...",
      });
    },

    onError: (err, request) => {
      // If the API call itself failed (before the worker even started),
      // clear the spinner so the user isn't stuck.
      setOptimizing(request.vehicleId, false);
      addToast({
        variant: "error",
        title: "Optimization failed",
        description: err instanceof ApiError ? err.message : "Could not start optimization",
      });
    },
  });
}
