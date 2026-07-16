/**
 * Test infrastructure -- boots a real API server against real Redis/MongoDB.
 *
 * Integration tests are more valuable than unit tests with mocks for this
 * project because the core value lies in the interaction between Redis Lua
 * scripts, streams, MongoDB persistence, and the Express HTTP layer.
 *
 * Usage:
 *   const ctx = await createTestContext();
 *   // ... run tests against ctx.baseUrl ...
 *   await ctx.cleanup();
 */

import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import Redis from "ioredis";
import { MongoClient, type Db } from "mongodb";

import { env } from "../src/config/env.ts";
import { createContainer, type Container } from "../src/config/container.ts";
import { createServer } from "../src/server.ts";
import { runHydration, type SeedData } from "../src/application/services/hydration.service.ts";
import { VehicleSchema, OrderSchema, SolutionSchema } from "@repo/shared";

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

export interface TestContext {
  /** Base URL of the test server (e.g. http://localhost:12345). */
  baseUrl: string;
  /** DI container for direct access in tests. */
  container: Container;
  /** Redis client for direct inspection in tests. */
  redis: Redis;
  /** Clean shutdown function -- must be called in afterAll. */
  cleanup: () => Promise<void>;
}

/* ------------------------------------------------------------------ */
/*  DRY HTTP client (eliminates fetch boilerplate in tests)            */
/* ------------------------------------------------------------------ */

export interface HttpResponse<T = unknown> {
  status: number;
  body: T;
}

export const createHttpClient = (baseUrl: string) => ({
  get: async <T = unknown>(path: string): Promise<HttpResponse<T>> => {
    const res = await fetch(`${baseUrl}${path}`);
    const body = await res.json() as T;
    return { status: res.status, body };
  },

  post: async <T = unknown>(path: string, data?: unknown): Promise<HttpResponse<T>> => {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: data !== undefined ? JSON.stringify(data) : undefined,
    });
    const body = await res.json() as T;
    return { status: res.status, body };
  },

  put: async <T = unknown>(path: string, data: unknown): Promise<HttpResponse<T>> => {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const body = await res.json() as T;
    return { status: res.status, body };
  },

  del: async <T = unknown>(path: string): Promise<HttpResponse<T>> => {
    const res = await fetch(`${baseUrl}${path}`, { method: "DELETE" });
    let body: T;
    try {
      body = await res.json() as T;
    } catch {
      body = {} as T;
    }
    return { status: res.status, body };
  },
});

export type HttpClient = ReturnType<typeof createHttpClient>;

/* ------------------------------------------------------------------ */
/*  Seed data loader (same as bootstrap -- DRY reuse)                  */
/* ------------------------------------------------------------------ */

const loadSeedData = (): SeedData => {
  const read = (file: string): unknown =>
    JSON.parse(readFileSync(resolve("data", file), "utf-8"));

  return {
    vehicles: z.array(VehicleSchema).parse(read("vehicles.json")),
    orders: z.array(OrderSchema).parse(read("orders.json")),
    solution: SolutionSchema.parse(read("solution.json")),
  };
};

/* ------------------------------------------------------------------ */
/*  Test context factory                                               */
/* ------------------------------------------------------------------ */

/**
 * Boot a fully-wired API server for integration testing.
 *
 * Steps:
 *   1. Connect Redis + flush all prefix keys (clean state)
 *   2. Connect MongoDB + drop database (clean state)
 *   3. Wire DI container + initialize (Lua scripts + indexes)
 *   4. Hydrate from seed data (identical to production startup)
 *   5. Listen on a random OS-assigned port
 *   6. Return context with baseUrl, container, and cleanup
 */
export const createTestContext = async (): Promise<TestContext> => {
  // ---- 1. Redis (non-singleton, test-scoped) ----
  const redis = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    username: env.REDIS_USERNAME || undefined,
    db: env.REDIS_DB,
    lazyConnect: true,
  });
  await redis.connect();

  // Flush all our namespaced keys for a clean test state
  const keys = await redis.keys("ws:default:*");
  if (keys.length) await redis.del(...keys);
  // Also flush stream keys
  await redis.del("events:stream", "results:stream").catch(() => {});

  // ---- 2. MongoDB (non-singleton, test-scoped) ----
  const mongoClient = new MongoClient(env.MONGO_URI);
  await mongoClient.connect();
  const mongoDb: Db = mongoClient.db(env.MONGO_DATABASE);

  // Drop all collections for clean state
  const collections = await mongoDb.listCollections().toArray();
  for (const col of collections) {
    await mongoDb.dropCollection(col.name);
  }

  // ---- 3. Wire container + initialize ----
  const container = createContainer({ redis, mongoDb });
  await container.initialize();

  // ---- 4. Hydrate from seed data ----
  const seedData = loadSeedData();
  await runHydration(
    { draftStore: container.draftStore, durableStore: container.durableStore, redis },
    seedData,
  );

  // ---- 5. Start HTTP server on random port ----
  const app = createServer(container);

  const { server, port } = await new Promise<{ server: Server; port: number }>(
    (resolve) => {
      const s = app.listen(0, () => {
        const addr = s.address();
        const p = typeof addr === "object" && addr ? addr.port : 0;
        resolve({ server: s, port: p });
      });
    },
  );

  const baseUrl = `http://localhost:${port}`;

  // ---- 6. Return test context ----
  return {
    baseUrl,
    container,
    redis,
    cleanup: async () => {
      container.resultsConsumer.stop();
      server.close();
      await redis.quit();
      await container.streamRedis.quit().catch(() => {});
      await mongoClient.close();
    },
  };
};
