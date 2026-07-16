/**
 * Worker process -- runs as a separate OS process.
 *
 * Consumes optimization requests from events:stream (consumer group),
 * simulates route optimization (sleep + shuffle), and publishes the
 * result to results:stream for the API process to apply.
 *
 * Architecture:
 *   events:stream  ──▶  Worker (XREADGROUP)
 *                         │  sleep 1s + shuffle route
 *   results:stream ◀──  XADD result
 *
 * The worker never touches MongoDB or the Redis hot-state directly.
 * It only reads the vehicle's current route (LRANGE) and publishes
 * a stream message. The API process applies the result atomically.
 *
 * Reliability:
 *   - Uses RedisStreamConsumer's built-in stale-claim option
 *     (XPENDING + XCLAIM) to reclaim messages stuck in pending
 *     state from crashed consumers.
 */
import { env } from "./config/env.ts";
import { logger } from "./shared/logger.ts";
import { createRedisClient } from "./infrastructure/redis/redis-client.ts";
import { RedisStreamConsumer } from "./infrastructure/redis/redis-stream-consumer.ts";
import { OptimizeEventSchema } from "@repo/shared";
import { STREAM_KEYS, REDIS_KEYS } from "./config/redis-keys.ts";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SIMULATE_DELAY_MS = 1_000;
const MAX_STREAM_LEN = 10_000;

/** Consumer name for this worker instance. */
const CONSUMER_NAME = "worker-1";

/** Messages idle longer than this are considered stale and reclaimed (ms). */
const STALE_CLAIM_MS = 60_000;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Fisher-Yates shuffle (in-place, returns same array). */
const shuffle = <T>(arr: T[]): T[] => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

const main = async () => {
  logger.info({ env: env.ENV }, "Starting optimization worker...");

  // Worker gets its own dedicated Redis connection
  const redis = createRedisClient("worker");
  await redis.connect();

  const consumer = new RedisStreamConsumer(
    redis,
    STREAM_KEYS.events,
    STREAM_KEYS.groups.optWorkers,
    CONSUMER_NAME,
    { staleClaimMs: STALE_CLAIM_MS },
  );

  // ---- Launch the blocking consume loop ----
  const consumePromise = consumer.consume(async (msg) => {
    // ---- 1. Validate incoming event ----
    const parsed = OptimizeEventSchema.safeParse({
      type: msg.data.type,
      vehicleId: msg.data.vehicleId,
      requestId: msg.data.requestId,
      baseRev: Number(msg.data.baseRev),
      timestamp: Number(msg.data.timestamp),
    });

    if (!parsed.success) {
      logger.warn(
        { id: msg.id, errors: parsed.error.flatten() },
        "Invalid optimize event, skipping",
      );
      return;
    }

    const event = parsed.data;
    logger.info(
      { vehicleId: event.vehicleId, requestId: event.requestId },
      "Processing optimization request",
    );

    // ---- 2. Read current route from Redis ----
    const currentRoute = await redis.lrange(
      REDIS_KEYS.route(event.vehicleId),
      0,
      -1,
    );

    // ---- 3. Simulate optimization (sleep + shuffle) ----
    await sleep(SIMULATE_DELAY_MS);
    const optimizedRoute = shuffle([...currentRoute]);

    // ---- 4. Publish result to results:stream ----
    await redis.xadd(
      STREAM_KEYS.results,
      "MAXLEN",
      "~",
      String(MAX_STREAM_LEN),
      "*",
      "type",
      "route_optimized",
      "vehicleId",
      event.vehicleId,
      "route",
      JSON.stringify(optimizedRoute),
      "requestId",
      event.requestId,
      "baseRev",
      String(event.baseRev),
      "timestamp",
      String(Date.now()),
    );

    logger.info(
      {
        vehicleId: event.vehicleId,
        requestId: event.requestId,
        orders: optimizedRoute.length,
      },
      "Optimization result published",
    );
  });

  // ---- Graceful shutdown ----
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Worker shutting down...");
    consumer.stop(); // Also clears the stale-claim interval
    await consumePromise; // Wait for the consume loop to finish
    await redis.quit();
    logger.info("Worker shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
};

main().catch((err) => {
  logger.fatal({ err }, "Worker failed to start");
  process.exit(1);
});

