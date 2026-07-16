import Redis from "ioredis";
import { env } from "../../config/env.ts";
import { logger } from "../../shared/logger.ts";

/**
 * Creates a new ioredis client configured from environment variables.
 * Used for both the main API client and dedicated subscriber connections.
 */
export const createRedisClient = (name = "default"): Redis => {
  const client = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    username: env.REDIS_USERNAME || undefined,
    db: env.REDIS_DB,
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 2000);
      logger.warn({ name, attempt: times, delay }, "Redis reconnecting...");
      return delay;
    },
    lazyConnect: true, // don't connect until first command or explicit .connect()
  });

  client.on("connect", () => logger.info({ name }, "Redis connected"));
  client.on("error", (err) => logger.error({ name, err }, "Redis error"));

  return client;
};

// Singleton for the main API client

let instance: Redis | null = null;

export const getRedisClient = (): Redis => {
  if (!instance) {
    instance = createRedisClient("main");
  }
  return instance;
};

export const disconnectRedis = async (): Promise<void> => {
  if (instance) {
    await instance.quit();
    instance = null;
  }
};
