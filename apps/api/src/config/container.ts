import type Redis from "ioredis";
import type { Db } from "mongodb";
import type { IDraftStore } from "../domain/ports/draft-store.port.ts";
import type { IDurableStore } from "../domain/ports/durable-store.port.ts";
import type { IStreamPublisher } from "../domain/ports/stream-publisher.port.ts";
import type { IStreamConsumer } from "../domain/ports/stream-consumer.port.ts";
import type { IRealtimeGateway } from "../domain/ports/realtime.port.ts";

import { RedisDraftStore } from "../infrastructure/redis/redis-draft-store.ts";
import { MongoDurableStore } from "../infrastructure/mongo/mongo-durable-store.ts";
import { RedisStreamPublisher } from "../infrastructure/redis/redis-stream-publisher.ts";
import { RedisStreamConsumer } from "../infrastructure/redis/redis-stream-consumer.ts";
import { SseGateway } from "../infrastructure/sse/sse-gateway.ts";
import { LuaScriptManager } from "../infrastructure/redis/lua/script-manager.ts";
import { LUA_SCRIPTS } from "../infrastructure/redis/lua/scripts.ts";

import { createRedisClient } from "../infrastructure/redis/redis-client.ts";
import { STREAM_KEYS } from "./redis-keys.ts";

/* ------------------------------------------------------------------ */
/*  Container type (pure interfaces -- DIP)                            */
/* ------------------------------------------------------------------ */

export interface Container {
  draftStore: IDraftStore;
  durableStore: IDurableStore & { ensureIndexes(): Promise<void> };
  streamPublisher: IStreamPublisher;
  resultsConsumer: IStreamConsumer;
  realtimeGateway: IRealtimeGateway;
  /** Main Redis client for general operations. */
  redis: Redis;
  /** Dedicated Redis connection for the blocking stream consumer. */
  streamRedis: Redis;

  /**
   * One-time initialization: loads Lua scripts (SHA-1) into Redis
   * and creates MongoDB indexes. Must be called before serving traffic.
   */
  initialize(): Promise<void>;
}

/* ------------------------------------------------------------------ */
/*  External dependencies supplied by bootstrap                        */
/* ------------------------------------------------------------------ */

export interface ContainerDeps {
  redis: Redis;
  mongoDb: Db;
}

/* ------------------------------------------------------------------ */
/*  Factory                                                            */
/* ------------------------------------------------------------------ */

/**
 * Composition root -- wires all infrastructure adapters to domain ports.
 * No DI framework needed; just a plain factory function.
 *
 * A separate Redis connection (`streamRedis`) is created for the
 * results-stream consumer because XREADGROUP BLOCK ties up the
 * connection until a message arrives.
 */
export const createContainer = (deps: ContainerDeps): Container => {
  const streamRedis = createRedisClient("results-consumer");

  const scriptManager = new LuaScriptManager(LUA_SCRIPTS);
  const durableStore = new MongoDurableStore(deps.mongoDb);
  const realtimeGateway = new SseGateway(deps.redis);

  return {
    redis: deps.redis,
    draftStore: new RedisDraftStore(deps.redis, scriptManager),
    durableStore,
    streamPublisher: new RedisStreamPublisher(deps.redis),
    resultsConsumer: new RedisStreamConsumer(
      streamRedis,
      STREAM_KEYS.results,
      STREAM_KEYS.groups.apiUpdaters,
      "api-1",
      { staleClaimMs: 60_000 },
    ),
    realtimeGateway,
    streamRedis,

    async initialize() {
      await Promise.all([
        scriptManager.loadAll(deps.redis),
        durableStore.ensureIndexes(),
        realtimeGateway.start(),
      ]);
    },
  };
};
