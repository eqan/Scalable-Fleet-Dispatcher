import type { IDraftStore } from "../../domain/ports/draft-store.port.ts";
import type { IRealtimeGateway } from "../../domain/ports/realtime.port.ts";
import type { AssignRequest, AssignResponse } from "@repo/shared";
import type { AppError } from "../../domain/errors.ts";
import type { Result } from "../../shared/result.ts";
import { tryCatch } from "../helpers.ts";

/* ------------------------------------------------------------------ */
/*  Dependencies (DIP -- depend on abstractions, not concretions)      */
/* ------------------------------------------------------------------ */

export interface AssignmentServiceDeps {
  draftStore: IDraftStore;
  gateway: IRealtimeGateway;
}

/* ------------------------------------------------------------------ */
/*  Service factory                                                    */
/* ------------------------------------------------------------------ */

/**
 * Handles order assignment, unassignment, and reassignment.
 *
 * A single method covers all three cases because the Lua script
 * atomically resolves the operation based on the current state:
 *   - vehicleId = "UNASSIGNED" → unassign
 *   - order already assigned   → reassign (remove from old, add to new)
 *   - order unassigned         → assign
 */
export const createAssignmentService = (deps: AssignmentServiceDeps) => ({
  assignOrder: async (
    req: AssignRequest,
  ): Promise<Result<AssignResponse, AppError>> => {
    const { orderId, vehicleId, position, baseRev } = req;

    return tryCatch(async () => {
      const { rev } = await deps.draftStore.assignOrder(
        orderId,
        vehicleId,
        position,
        baseRev,
      );

      deps.gateway.broadcast({
        kind: "order_assigned",
        rev,
        orderId,
        vehicleId,
      });

      return { rev, success: true };
    });
  },
});

export type AssignmentService = ReturnType<typeof createAssignmentService>;
