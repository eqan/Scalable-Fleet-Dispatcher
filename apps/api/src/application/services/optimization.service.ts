import type { IDraftStore } from "../../domain/ports/draft-store.port.ts";
import type { IStreamPublisher } from "../../domain/ports/stream-publisher.port.ts";
import type { OptimizeRequest, OptimizeResponse } from "@repo/shared";
import type { AppError } from "../../domain/errors.ts";
import type { Result } from "../../shared/result.ts";
import { AppError as AppErrorClass } from "../../domain/errors.ts";
import { tryCatch } from "../helpers.ts";

/* ------------------------------------------------------------------ */
/*  Dependencies                                                       */
/* ------------------------------------------------------------------ */

export interface OptimizationServiceDeps {
  draftStore: IDraftStore;
  streamPublisher: IStreamPublisher;
}

/* ------------------------------------------------------------------ */
/*  Service factory                                                    */
/* ------------------------------------------------------------------ */

/**
 * Handles optimization requests via the 202 Accepted pattern:
 *
 *   1. Validate the vehicle exists
 *   2. XADD an optimize_route event to events:stream
 *   3. Return immediately with { requestId, eventId }
 *
 * The actual optimization happens asynchronously in the worker process.
 * Results flow back via results:stream → API consumer → SSE broadcast.
 */
export const createOptimizationService = (deps: OptimizationServiceDeps) => ({
  requestOptimization: async (
    req: OptimizeRequest,
  ): Promise<Result<OptimizeResponse, AppError>> => {
    return tryCatch(async () => {
      // Validate the vehicle exists before queueing work
      const vehicle = await deps.draftStore.getVehicle(req.vehicleId);
      if (!vehicle) {
        throw AppErrorClass.notFound("Vehicle", req.vehicleId);
      }

      const requestId = crypto.randomUUID();

      // Capture rev at request time -- this is the OCC anchor that
      // travels through the pipeline and gates the Lua update.
      const baseRev = (await deps.draftStore.getRev()) ?? 0;

      const eventId = await deps.streamPublisher.publishOptimizeEvent(
        req.vehicleId,
        requestId,
        baseRev,
      );

      return { requestId, eventId };
    });
  },
});

export type OptimizationService = ReturnType<typeof createOptimizationService>;
