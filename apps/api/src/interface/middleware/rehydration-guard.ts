import type { Request, Response, NextFunction } from "express";
import type Redis from "ioredis";
import type { IDraftStore } from "../../domain/ports/draft-store.port.ts";
import type { IDurableStore } from "../../domain/ports/durable-store.port.ts";
import { env } from "../../config/env.ts";
import { REDIS_KEYS } from "../../config/redis-keys.ts";
import { AppError } from "../../domain/errors.ts";
import { logger } from "../../shared/logger.ts";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** How long the rehydration lock is held (ms). */
const LOCK_TTL_MS = 30_000;

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface RehydrationGuardDeps {
  draftStore: IDraftStore;
  durableStore: IDurableStore;
  redis: Redis;
}

/* ------------------------------------------------------------------ */
/*  Middleware factory                                                  */
/* ------------------------------------------------------------------ */

/**
 * Fail-safe auto-rehydration middleware.
 *
 * Detects a cold Redis (missing `ws:default:rev`) on every request and
 * transparently rehydrates from the latest MongoDB snapshot.
 *
 * This handles the scenario where Redis is restarted mid-operation.
 * Overhead per request: one O(1) Redis `GET` -- negligible (~0.1ms).
 *
 * Multi-instance safe: uses the same distributed-lock pattern as the
 * startup hydration to prevent duplicate rehydration.
 */
export const createRehydrationGuard = (deps: RehydrationGuardDeps) => {
  const { draftStore, durableStore, redis } = deps;
  let lastWarmCheckAt = 0;
  let lastKnownWarm = false;

  return async (_req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const now = Date.now();

      // Fastest path: recently confirmed warm state -> skip Redis call.
      if (
        lastKnownWarm &&
        now - lastWarmCheckAt < env.REHYDRATION_GUARD_CHECK_MS
      ) {
        next();
        return;
      }

      // Fast path: Redis is warm → continue immediately
      const rev = await draftStore.getRev();
      lastWarmCheckAt = now;
      if (rev !== null) {
        lastKnownWarm = true;
        next();
        return;
      }
      lastKnownWarm = false;

      logger.warn("Redis state lost -- attempting auto-rehydration from MongoDB");

      // Acquire distributed lock (prevents multiple instances rehydrating simultaneously)
      const acquired = await redis.set(
        REDIS_KEYS.hydrating,
        "1",
        "PX",
        LOCK_TTL_MS,
        "NX",
      );

      if (!acquired) {
        // Another instance is already rehydrating -- ask client to retry
        next(
          AppError.serviceUnavailable(
            "Rehydration in progress by another instance, retry shortly",
          ),
        );
        return;
      }

      try {
        const snapshot = await durableStore.getLatestSnapshot();

        if (!snapshot) {
          next(
            AppError.serviceUnavailable(
              "No snapshot available for rehydration -- initial seed may not have run",
            ),
          );
          return;
        }

        await draftStore.hydrateFromSnapshot(
          snapshot.vehicles,
          snapshot.orders,
          snapshot.solution,
          snapshot.rev,
        );
        lastKnownWarm = true;
        lastWarmCheckAt = Date.now();
        logger.info("Auto-rehydration from MongoDB complete");
        next();
      } finally {
        await redis.del(REDIS_KEYS.hydrating);
      }
    } catch (err) {
      next(err);
    }
  };
};
