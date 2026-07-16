/**
 * useSaveMutation -- TanStack mutation for POST /api/save.
 *
 * Flow:
 *   1. User clicks "Save Plan" or presses Ctrl+S
 *   2. mutationFn: POST /api/save (persists Redis → MongoDB)
 *   3. On success: clear local dirty flag immediately
 *      (SSE `state_saved` still handles cross-tab sync)
 *   4. On error: keeps dirty flag, surfaces error to UI
 *
 * We clear dirty in both places:
 *   - here (local save succeeds even if SSE is disconnected)
 *   - SSEProvider on `state_saved` (cross-tab consistency)
 *
 * DRY: This is the ONLY place that calls api.save().
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api.ts";
import { QUERY_KEYS } from "./useHotState.ts";
import { useUIStore } from "../stores/ui.store.ts";
import { useToastStore } from "../stores/toast.store.ts";

export function useSaveMutation() {
  const queryClient = useQueryClient();
  const clearDirty = useUIStore((s) => s.clearDirty);
  const addToast = useToastStore((s) => s.addToast);

  return useMutation({
    mutationFn: () => api.save(),

    onSuccess: () => {
      clearDirty();
      // Ensure query cache is fresh after save.
      // SSEProvider will also invalidate + clearDirty,
      // but this covers the case where SSE event is delayed.
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.hotState });
      addToast({
        variant: "success",
        title: "Plan saved",
        description: "State persisted to database successfully",
      });
    },

    onError: (err) => {
      addToast({
        variant: "error",
        title: "Save failed",
        description: err instanceof ApiError ? err.message : "Could not save plan to database",
      });
    },
  });
}
