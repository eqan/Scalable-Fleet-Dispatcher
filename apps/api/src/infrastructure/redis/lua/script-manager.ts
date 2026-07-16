import type Redis from "ioredis";
import { logger } from "../../../shared/logger.ts";

/**
 * Manages Lua script lifecycle: SCRIPT LOAD at startup, EVALSHA at runtime.
 *
 * Why this matters:
 *   - EVAL sends the full script text on every call (~1-2 KB per request).
 *   - EVALSHA sends a 40-char SHA-1 hash instead (saves bandwidth).
 *   - If Redis restarts and flushes its script cache, NOSCRIPT is returned;
 *     this manager detects that and transparently reloads + retries.
 */
export class LuaScriptManager {
  private shaCache = new Map<string, string>();

  constructor(private readonly scripts: Record<string, string>) {}

  /**
   * Pre-load all scripts into Redis via SCRIPT LOAD (pipelined).
   * Must be called during bootstrap before any exec() calls.
   */
  async loadAll(redis: Redis): Promise<void> {
    const entries = Object.entries(this.scripts);
    const pipeline = redis.pipeline();

    for (const [, body] of entries) {
      pipeline.script("LOAD", body);
    }

    const results = await pipeline.exec();
    if (!results) throw new Error("Script load pipeline returned null");

    for (let i = 0; i < entries.length; i++) {
      const [name] = entries[i]!;
      const [err, sha] = results[i]!;
      if (err) throw err;
      this.shaCache.set(name, sha as string);
    }

    logger.info(
      { scripts: entries.map(([n]) => n) },
      "Lua scripts loaded into Redis (SHA-1 cached)",
    );
  }

  /**
   * Execute a registered script by name using EVALSHA.
   * Falls back to SCRIPT LOAD + retry on NOSCRIPT (Redis restart).
   */
  async exec<T>(
    redis: Redis,
    name: string,
    keys: string[],
    args: (string | number)[],
  ): Promise<T> {
    const sha = this.shaCache.get(name);
    const body = this.scripts[name];

    if (!sha || !body) {
      throw new Error(`Lua script '${name}' not registered`);
    }

    try {
      return (await redis.evalsha(
        sha,
        keys.length,
        ...keys,
        ...args,
      )) as T;
    } catch (err: unknown) {
      // NOSCRIPT = Redis restarted and flushed its script cache
      if (err instanceof Error && err.message.includes("NOSCRIPT")) {
        logger.warn({ name }, "NOSCRIPT detected, reloading script");
        const newSha = (await redis.script("LOAD", body)) as string;
        this.shaCache.set(name, newSha);
        return (await redis.evalsha(
          newSha,
          keys.length,
          ...keys,
          ...args,
        )) as T;
      }
      throw err;
    }
  }
}
