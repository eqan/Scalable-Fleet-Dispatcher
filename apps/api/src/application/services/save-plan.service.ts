import type { IDraftStore } from "../../domain/ports/draft-store.port.ts";
import type { IDurableStore } from "../../domain/ports/durable-store.port.ts";
import type { IRealtimeGateway } from "../../domain/ports/realtime.port.ts";
import type { SaveResponse } from "@repo/shared";
import type { AppError } from "../../domain/errors.ts";
import type { Result } from "../../shared/result.ts";
import { tryCatch } from "../helpers.ts";

/* ------------------------------------------------------------------ */
/*  Dependencies (DIP -- depend on abstractions, not concretions)      */
/* ------------------------------------------------------------------ */

export interface SavePlanServiceDeps {
  draftStore: IDraftStore;
  durableStore: IDurableStore;
  gateway: IRealtimeGateway;
}

/* ------------------------------------------------------------------ */
/*  Service factory                                                    */
/* ------------------------------------------------------------------ */

/**
 * Persist the current in-memory planning state (Redis) to MongoDB.
 *
 * Flow:
 *   1. Read full state from the Redis hot store (atomic read via pipeline)
 *   2. Construct a Snapshot document (vehicles + orders + solution + rev)
 *   3. Save to MongoDB (single-doc insert = atomic)
 *   4. Sync master-data collections (vehicles, orders) for consistency
 *
 * The operation is idempotent -- saving the same rev twice just creates
 * another snapshot document (no harm, latest-by-date wins on restore).
 */
export const createSavePlanService = (deps: SavePlanServiceDeps) => ({
  save: async (): Promise<Result<SaveResponse, AppError>> => {
    return tryCatch(async () => {
      // Step 1: Read full planning state from Redis
      const state = await deps.draftStore.getFullState();

      // Step 2: Build snapshot
      const savedAt = new Date();
      const snapshot = {
        vehicles: state.vehicles,
        orders: state.orders,
        solution: state.solution,
        savedAt,
        rev: state.rev,
      };

      // Step 3+4: Persist to MongoDB (snapshot + master-data sync)
      await deps.durableStore.saveSnapshot(snapshot);

      // Step 5: Broadcast to all SSE clients so dirty flags clear across tabs
      deps.gateway.broadcast({
        kind: "state_saved",
        rev: state.rev,
      });

      return {
        success: true,
        savedRev: state.rev,
        savedAt: savedAt.toISOString(),
      };
    });
  },
});

export type SavePlanService = ReturnType<typeof createSavePlanService>;
