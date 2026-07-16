import type Redis from "ioredis";
import type { IDraftStore } from "../../domain/ports/draft-store.port.ts";
import type { IDurableStore } from "../../domain/ports/durable-store.port.ts";
import type { Vehicle, Order, Solution } from "@repo/shared";
import { REDIS_KEYS, STREAM_KEYS } from "../../config/redis-keys.ts";
import { logger } from "../../shared/logger.ts";


// Public types   

// Data to seed MongoDB on first run. Loaded from data/*.json.
export interface SeedData {
  vehicles: Vehicle[];
  orders: Order[];
  solution: Solution;
}

// Dependencies injected into the hydration service (DIP).
export interface HydrationDeps {
  draftStore: IDraftStore;
  durableStore: IDurableStore;
  // Main Redis client -- used for the distributed hydration lock.
  redis: Redis;
}

// Constants   

// How long the hydration lock is held before auto-expiring (ms).
const LOCK_TTL_MS = 30_000;
// How often to poll when waiting for another instance's hydration.
const LOCK_POLL_MS = 500;
// Maximum time to wait for another instance to finish hydrating.
const LOCK_MAX_WAIT_MS = 60_000;

// Main entry point                                                  

/**
 * Run the full startup hydration sequence:
 *
 *   1. Seed MongoDB with initial data (idempotent bulk-upsert)
 *   2. Check if Redis is warm (ws:default:rev exists)
 *   3. If cold → acquire distributed lock → load from Mongo → hydrate Redis
 *   4. Ensure both stream consumer groups exist
 *
 * Designed for multi-instance safety: only one instance performs
 * the actual hydration; others wait and verify.
 */
export const runHydration = async (
  deps: HydrationDeps,
  seedData: SeedData,
): Promise<void> => {
  const { draftStore, durableStore, redis } = deps;

  // Step 1: Seed MongoDB (empty-only -- preserves user data on restart)
  // Convenience collections first (independent, parallel-safe).
  // Snapshot last -- if crash occurs before snapshot write, the next
  // startup will re-attempt all seeding since no snapshot exists.
  await Promise.all([
    durableStore.seedVehicles(seedData.vehicles),
    durableStore.seedOrders(seedData.orders),
  ]);
  await durableStore.seedSnapshot(seedData.vehicles, seedData.orders, seedData.solution);
  logger.info("MongoDB seed check complete (empty-only)");

  // Step 2: Check Redis warmth
  const existingRev = await draftStore.getRev();
  if (existingRev !== null) {
    logger.info({ rev: existingRev }, "Redis is warm, skipping hydration");
    await ensureStreamGroups(redis);
    return;
  }

  // Step 3: Cold Redis -- acquire lock + hydrate
  logger.info("Redis is cold, attempting hydration...");

  const acquired = await redis.set(
    REDIS_KEYS.hydrating,
    "1",
    "PX",
    LOCK_TTL_MS,
    "NX",
  );

  if (!acquired) {
    logger.info("Hydration lock held by another instance, waiting...");
    await waitForHydration(draftStore);
    await ensureStreamGroups(redis);
    return;
  }

  try {
    const snapshot = await durableStore.getLatestSnapshot();

    if (!snapshot) {
      throw new Error("No snapshot found in MongoDB after seeding");
    }

    const { vehicles, orders, solution, rev: snapshotRev } = snapshot;

    // Restore Redis state at the persisted revision (not hardcoded 1)
    await draftStore.hydrateFromSnapshot(vehicles, orders, solution, snapshotRev);

    logger.info(
      {
        vehicles: vehicles.length,
        orders: orders.length,
        assignments: solution.assignments.length,
        rev: snapshotRev,
      },
      "Redis hydrated from MongoDB",
    );
  } finally {
    // Always release the lock, even if hydration fails
    await redis.del(REDIS_KEYS.hydrating);
  }

  // Step 4: Ensure stream consumer groups exist
  await ensureStreamGroups(redis);
};


// Internal helpers                                                  

/**
 * Wait for another instance to finish hydration by polling for rev.
 * Throws if the deadline is exceeded.
 */
const waitForHydration = async (draftStore: IDraftStore): Promise<void> => {
  const deadline = Date.now() + LOCK_MAX_WAIT_MS;

  while (Date.now() < deadline) {
    await sleep(LOCK_POLL_MS);
    const rev = await draftStore.getRev();
    if (rev !== null) {
      logger.info({ rev }, "Hydration completed by another instance");
      return;
    }
  }

  throw new Error(
    `Timed out after ${LOCK_MAX_WAIT_MS}ms waiting for hydration to complete`,
  );
};

/**
 * Idempotently create consumer groups for both streams.
 * BUSYGROUP error = group already exists → safe to ignore.
 */
const ensureStreamGroups = async (redis: Redis): Promise<void> => {
  const groups = [
    { stream: STREAM_KEYS.events, group: STREAM_KEYS.groups.optWorkers },
    { stream: STREAM_KEYS.results, group: STREAM_KEYS.groups.apiUpdaters },
  ];

  for (const { stream, group } of groups) {
    try {
      await redis.xgroup("CREATE", stream, group, "0", "MKSTREAM");
      logger.debug({ stream, group }, "Consumer group created");
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("BUSYGROUP")) continue;
      throw err;
    }
  }

  logger.info("Stream consumer groups ensured");
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
