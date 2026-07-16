/**
 * SSEProvider -- React lifecycle wrapper for the SSE sync engine.
 *
 * Responsibilities:
 *   1. Opens the SSE connection on mount, closes on unmount.
 *   2. Invalidates TanStack Query cache on `state_changed` events
 *      (smart invalidation based on event `kind`).
 *   3. Updates the Zustand connection store for UI status dot.
 *   4. Clears optimization spinners when `route_optimized` events arrive.
 *   5. Marks the plan as dirty on any mutation event.
 *
 * This provider sits near the root of the tree so every component benefits
 * from the live-updating cache without needing to manage SSE directly.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SSEClient, type StateChangeEvent } from "../lib/sse.ts";
import { useConnectionStore } from "../stores/connection.store.ts";
import { useUIStore } from "../stores/ui.store.ts";
import { useToastStore } from "../stores/toast.store.ts";
import { QUERY_KEYS } from "../hooks/useHotState.ts";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SSE_URL = "/api/events";

/**
 * Debounce window for query invalidation (ms).
 * Prevents hammering the API when rapid-fire events arrive
 * (e.g. bulk assignment or optimization results).
 */
const INVALIDATION_DEBOUNCE_MS = 100;

/* ------------------------------------------------------------------ */
/*  Event-kind classification for smart invalidation                   */
/* ------------------------------------------------------------------ */

/** Events that mutate draft state (mark dirty). */
const MUTATION_KINDS = new Set([
  "order_assigned",
  "order_unassigned",
  "order_reassigned",
  "route_reordered",
  "vehicle_dropped",
  "vehicle_created",
  "vehicle_updated",
  "vehicle_deleted",
  "order_created",
  "order_updated",
  "order_deleted",
  "route_optimized",
]);

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface SSEProviderProps {
  children: ReactNode;
}

export function SSEProvider({ children }: SSEProviderProps) {
  const queryClient = useQueryClient();
  const setConnected = useConnectionStore((s) => s.setConnected);
  const setOptimizing = useUIStore((s) => s.setOptimizing);
  const markDirty = useUIStore((s) => s.markDirty);
  const clearDirty = useUIStore((s) => s.clearDirty);
  const addToast = useToastStore((s) => s.addToast);

  // Refs to hold latest callbacks (avoids re-creating SSEClient on every render)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasConnectedRef = useRef(false);

  useEffect(() => {
    const invalidateState = () => {
      // Debounce: collapse rapid events into one re-fetch
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.hotState });
      }, INVALIDATION_DEBOUNCE_MS);
    };

    const handleStateChange = (event: StateChangeEvent) => {
      // Always invalidate the query cache so UI reflects new server state
      invalidateState();

      // Mark dirty on mutations (so the Save button shows a badge)
      if (MUTATION_KINDS.has(event.kind)) {
        markDirty();
      }

      // Clear optimization spinner when the result arrives
      if (event.kind === "route_optimized" && event.vehicleId) {
        setOptimizing(event.vehicleId, false);
        addToast({
          variant: "success",
          title: "Route optimized",
          description: "Optimization completed successfully",
        });
      }

      // Clear dirty flag when state is saved to MongoDB
      if (event.kind === "state_saved") {
        clearDirty();
      }
    };

    const client = new SSEClient(SSE_URL, {
      onOpen: () => {
        if (wasConnectedRef.current) {
          // Reconnection -- notify user
          addToast({
            variant: "info",
            title: "Reconnected",
            description: "Live sync restored",
          });
        }
        wasConnectedRef.current = true;
        setConnected(true);
      },
      onStateChange: handleStateChange,
      onError: () => setConnected(false),
      onMissedEvents: () => {
        // Replay buffer overflow -- force full state re-fetch
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.hotState });
        addToast({
          variant: "warning",
          title: "Connection gap detected",
          description: "State resynced from server",
        });
      },
    });

    client.connect();

    return () => {
      client.disconnect();
      setConnected(false);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // Intentional: we only want to run this once on mount.
    // The latest store actions are accessed via Zustand's subscribe model,
    // which doesn't require re-creating the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <>{children}</>;
}
