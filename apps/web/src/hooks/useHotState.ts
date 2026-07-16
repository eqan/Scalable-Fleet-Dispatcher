/**
 * useHotState -- TanStack Query hook for the authoritative planning state.
 *
 * Design principles:
 *   - Single source of truth: all components read from this one query.
 *   - Server-state only: TanStack Query owns the cache, SSEProvider
 *     invalidates it on backend events.
 *   - DRY: no component fetches `/api/state` directly. They all use
 *     this hook, and combine it with selectors from `lib/selectors.ts`.
 *   - Stale-while-revalidate: the query is pre-configured with a 30s
 *     staleTime so SSE-triggered refetches don't cause waterfalls.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { StateResponse } from "@repo/shared";
import { api } from "../lib/api.ts";

/* ------------------------------------------------------------------ */
/*  Query keys -- exported for cache invalidation in SSEProvider       */
/* ------------------------------------------------------------------ */

export const QUERY_KEYS = {
  hotState: ["hotState"] as const,
} as const;

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

/**
 * Fetches and caches the full planning state from `GET /api/state`.
 *
 * Components should combine this with selectors:
 * ```ts
 * const { data } = useHotState();
 * const vehicles = data ? vehiclesById(data) : {};
 * ```
 */
export function useHotState(): UseQueryResult<StateResponse> {
  return useQuery({
    queryKey: QUERY_KEYS.hotState,
    queryFn: api.getState,
  });
}
