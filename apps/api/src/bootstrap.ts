import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { env } from "./config/env.ts";
import { logger } from "./shared/logger.ts";
import { getRedisClient, disconnectRedis } from "./infrastructure/redis/redis-client.ts";
import { connectMongo, disconnectMongo } from "./infrastructure/mongo/mongo-client.ts";
import { createContainer } from "./config/container.ts";
import { createServer } from "./server.ts";
import { runHydration, type SeedData } from "./application/services/hydration.service.ts";
import { createResultsHandler } from "./application/services/results-handler.ts";
import { VehicleSchema, OrderSchema, SolutionSchema } from "@repo/shared";

/* ------------------------------------------------------------------ */
/*  Seed data loader                                                   */
/* ------------------------------------------------------------------ */

/**
 * Load and Zod-validate seed data from static JSON files.
 * Fails fast at startup if the data is malformed.
 */
const loadSeedData = (): SeedData => {
  const read = (file: string): unknown =>
    JSON.parse(readFileSync(resolve("data", file), "utf-8"));

  const vehicles = z.array(VehicleSchema).parse(read("vehicles.json"));
  const orders = z.array(OrderSchema).parse(read("orders.json"));
  const solution = SolutionSchema.parse(read("solution.json"));

  logger.debug(
    { vehicles: vehicles.length, orders: orders.length },
    "Seed data loaded and validated",
  );

  return { vehicles, orders, solution };
};

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

const main = async () => {
  logger.info({ env: env.ENV }, "Starting Arqh Backend...");

  // ---- 1. Connect to external services ----
  const redis = getRedisClient();
  await redis.connect();
  logger.info("Redis connection established");

  const { db: mongoDb } = await connectMongo();
  logger.info("MongoDB connection established");

  // ---- 2. Wire container + one-time init (Lua SHA-1 + indexes) ----
  const container = createContainer({ redis, mongoDb });
  await container.initialize();
  logger.info("Container initialized (Lua scripts cached, indexes ensured)");

  // ---- 3. Run hydration (seed Mongo → warm Redis → stream groups) ----
  const seedData = loadSeedData();
  await runHydration(
    { draftStore: container.draftStore, durableStore: container.durableStore, redis },
    seedData,
  );

  // ---- 4. Start results:stream consumer (background, non-blocking) ----
  const resultsHandler = createResultsHandler({
    draftStore: container.draftStore,
    gateway: container.realtimeGateway,
  });

  container.resultsConsumer
    .consume(resultsHandler)
    .catch((err) => {
      logger.error({ err }, "Results consumer crashed");
    });

  // ---- 5. Start HTTP server ----
  const app = createServer(container);

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "Server listening");
  });

  // ---- 6. Graceful shutdown (10 s hard timeout) ----
  const SHUTDOWN_TIMEOUT_MS = 10_000;

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down...");

    // Hard-kill if cleanup hangs
    const forceExit = setTimeout(() => {
      logger.warn("Shutdown timed out -- forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    container.resultsConsumer.stop();
    server.close();
    await Promise.all([
      container.realtimeGateway.stop(),
      disconnectRedis(),
      disconnectMongo(),
      container.streamRedis.quit(),
    ]);
    logger.info("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
};

main().catch((err) => {
  logger.fatal({ err }, "Failed to start server");
  process.exit(1);
});
