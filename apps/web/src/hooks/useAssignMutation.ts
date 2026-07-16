/**
 * useAssignMutation -- TanStack mutation for all drag-and-drop operations.
 *
 * All 5 dispatch operations (assign, unassign, reassign, reorder, drop-vehicle)
 * hit the same `POST /api/assign` endpoint. This hook wraps the API call with:
 *   - Optimistic cache update (instant UI feedback)
 *   - Automatic rollback on error
 *   - Dirty-state marking via Zustand
 *   - SSE will eventually reconcile with authoritative state
 *
 * DRY: one mutation for every drag-and-drop operation.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { StateResponse, AssignRequest } from "@repo/shared";
import { api, ApiError } from "../lib/api.ts";
import { QUERY_KEYS } from "./useHotState.ts";
import { UNASSIGNED_CONTAINER } from "../lib/dnd.ts";
import { useUIStore } from "../stores/ui.store.ts";
import { useToastStore } from "../stores/toast.store.ts";

export function useAssignMutation() {
  const queryClient = useQueryClient();
  const markDirty = useUIStore((s) => s.markDirty);
  const clearDirty = useUIStore((s) => s.clearDirty);
  const addToast = useToastStore((s) => s.addToast);

  return useMutation({
    mutationFn: (request: AssignRequest) => api.assign(request),

    onMutate: async (request) => {
      // Cancel in-flight queries to avoid overwriting our optimistic update
      await queryClient.cancelQueries({ queryKey: QUERY_KEYS.hotState });

      // Snapshot previous state for rollback
      const previous = queryClient.getQueryData<StateResponse>(QUERY_KEYS.hotState);
      const previousIsDirty = useUIStore.getState().isDirty;
      if (!previous) return { previous, previousIsDirty };

      // Build optimistic state
      const next = applyOptimisticAssign(previous, request);
      queryClient.setQueryData<StateResponse>(QUERY_KEYS.hotState, next);

      markDirty();

      return { previous, previousIsDirty };
    },

    onError: (err, _request, context) => {
      // Rollback on failure
      if (context?.previous) {
        queryClient.setQueryData<StateResponse>(
          QUERY_KEYS.hotState,
          context.previous,
        );
      }
      if (context) {
        if (context.previousIsDirty) markDirty();
        else clearDirty();
      }
      addToast({
        variant: "error",
        title: "Assignment failed",
        description: err instanceof ApiError ? err.message : "Could not update assignment",
      });
    },

    onSettled: () => {
      // SSE will also invalidate, but this ensures consistency
      // even if the SSE event is delayed
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.hotState });
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Pure optimistic state transformer (no side effects, testable)      */
/* ------------------------------------------------------------------ */

function applyOptimisticAssign(
  state: StateResponse,
  request: AssignRequest,
): StateResponse {
  const { orderId, vehicleId, position } = request;
  const isUnassign = vehicleId === UNASSIGNED_CONTAINER;

  // Clone assignments deeply (avoid mutating cache)
  const assignments = state.solution.assignments.map((a) => ({
    ...a,
    route: [...a.route],
  }));
  const unassigned = [...state.unassignedOrderIds];

  // 1. Remove order from its current location
  const unassignedIdx = unassigned.indexOf(orderId);
  if (unassignedIdx !== -1) {
    unassigned.splice(unassignedIdx, 1);
  }
  for (const a of assignments) {
    const routeIdx = a.route.indexOf(orderId);
    if (routeIdx !== -1) {
      a.route.splice(routeIdx, 1);
      break;
    }
  }

  // 2. Place order in its new location
  if (isUnassign) {
    unassigned.push(orderId);
  } else {
    let target = assignments.find((a) => a.vehicle_id === vehicleId);
    if (!target) {
      // Vehicle has no assignment entry yet -- create one
      target = { vehicle_id: vehicleId, route: [] };
      assignments.push(target);
    }
    const insertAt = position != null
      ? Math.min(position, target.route.length)
      : target.route.length;
    target.route.splice(insertAt, 0, orderId);
  }

  return {
    ...state,
    rev: state.rev + 1, // optimistic rev bump
    solution: { assignments },
    unassignedOrderIds: unassigned,
  };
}
