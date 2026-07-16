import type { IDraftStore } from "../../domain/ports/draft-store.port.ts";
import type { IRealtimeGateway } from "../../domain/ports/realtime.port.ts";
import type { StreamMessage } from "../../domain/ports/stream-consumer.port.ts";
import { ResultEventSchema } from "@repo/shared";
import { AppError } from "../../domain/errors.ts";
import { logger } from "../../shared/logger.ts";

/* ------------------------------------------------------------------ */
/*  Dependencies                                                       */
/* ------------------------------------------------------------------ */

export interface ResultsHandlerDeps {
  draftStore: IDraftStore;
  gateway: IRealtimeGateway;
}

/* ------------------------------------------------------------------ */
/*  Factory                                                            */
/* ------------------------------------------------------------------ */

/**
 * Creates a handler for results:stream messages (consumed by the API process).
 *
 * Flow:
 *   1. Zod-validate the incoming stream fields as a ResultEvent
 *   2. Apply the optimized route atomically via Lua (updateRoute)
 *   3. Broadcast an SSE event so connected frontends update in real-time
 *
 * Invalid messages are logged and skipped -- never block the consumer loop.
 * Expected stale-result errors (NOT_FOUND, CONFLICT) are caught and
 * swallowed so XACK proceeds and the message exits the PEL.
 */
export const createResultsHandler = (deps: ResultsHandlerDeps) => {
  return async (msg: StreamMessage): Promise<void> => {
    // Reject messages with missing route field -- an absent route is a
    // malformed upstream event, not an intentional empty route.
    if (msg.data.route == null) {
      logger.warn(
        { id: msg.id },
        "Missing 'route' field in result event, skipping",
      );
      return;
    }

    // Parse route JSON safely -- malformed payload must not crash the consumer
    let route: unknown;
    try {
      route = JSON.parse(msg.data.route);
    } catch {
      logger.warn(
        { id: msg.id, rawRoute: msg.data.route },
        "Malformed route JSON in result event, skipping",
      );
      return;
    }

    // Stream fields are all strings -- coerce into typed ResultEvent
    const parsed = ResultEventSchema.safeParse({
      type: msg.data.type,
      vehicleId: msg.data.vehicleId,
      route,
      requestId: msg.data.requestId,
      baseRev: Number(msg.data.baseRev),
      timestamp: Number(msg.data.timestamp),
    });

    if (!parsed.success) {
      logger.warn(
        { id: msg.id, errors: parsed.error.flatten() },
        "Invalid result event, skipping",
      );
      return;
    }

    const event = parsed.data;

    // Atomic route update via Lua script (increments rev).
    // Pass baseRev for OCC -- rejects if state changed since optimization started.
    let rev: number;
    try {
      ({ rev } = await deps.draftStore.updateRoute(
        event.vehicleId,
        event.route,
        event.baseRev,
      ));
    } catch (err) {
      // Expected stale-result errors: vehicle deleted, rev conflict,
      // or capacity check failure on a now-changed plan.
      // Swallow so XACK proceeds and the message exits the PEL.
      if (
        err instanceof AppError &&
        (
          err.code === "NOT_FOUND" ||
          err.code === "CONFLICT" ||
          err.code === "CAPACITY_EXCEEDED"
        )
      ) {
        logger.warn(
          { vehicleId: event.vehicleId, requestId: event.requestId, error: err.message },
          "Stale optimization result, discarding",
        );
        return;
      }
      // Unexpected errors re-throw → consumer backoff + retry
      throw err;
    }

    // Broadcast to all SSE clients
    deps.gateway.broadcast({
      kind: "route_optimized",
      rev,
      vehicleId: event.vehicleId,
      data: { route: event.route, requestId: event.requestId },
    });

    logger.info(
      { vehicleId: event.vehicleId, rev, requestId: event.requestId },
      "Route optimization applied",
    );
  };
};
