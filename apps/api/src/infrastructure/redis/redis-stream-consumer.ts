import type Redis from "ioredis";
import type {
  IStreamConsumer,
  StreamMessage,
} from "../../domain/ports/stream-consumer.port.ts";
import { logger } from "../../shared/logger.ts";

/** ioredis XREADGROUP return shape. */
type XReadGroupResult = [string, [string, string[]][]][] | null;

/** Backoff ceiling when the consumer encounters errors. */
const ERROR_BACKOFF_MS = 2_000;

/** How often to run the stale-claim check when enabled (ms). */
const STALE_CHECK_INTERVAL_MS = 30_000;

/** Maximum pending entries to scan per check. */
const STALE_SCAN_COUNT = 100;

/* ------------------------------------------------------------------ */
/*  Options                                                            */
/* ------------------------------------------------------------------ */

export interface StreamConsumerOptions {
  /**
   * When set (> 0), enables periodic XPENDING + XCLAIM to reclaim
   * messages that have been idle beyond this threshold (ms).
   *
   * This ensures no message stays stuck in the PEL indefinitely,
   * whether the consumer is the worker process or the API process.
   */
  staleClaimMs?: number;
}

/**
 * Redis Streams consumer-group reader.
 *
 * Uses XREADGROUP with BLOCK for efficient polling.
 * A **dedicated** Redis connection must be supplied because
 * BLOCK ties up the connection until a message arrives.
 *
 * Optionally reclaims stale pending messages via XPENDING + XCLAIM
 * when `staleClaimMs` is configured (DRY -- same pattern for worker
 * and API consumer, eliminating the duplication that was in worker.ts).
 */
export class RedisStreamConsumer implements IStreamConsumer {
  private running = false;
  private staleTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly redis: Redis,
    private readonly streamKey: string,
    private readonly groupName: string,
    private readonly consumerName: string,
    private readonly options: StreamConsumerOptions = {},
  ) {}

  /* ---------------------------------------------------------------- */
  /*  Public API                                                       */
  /* ---------------------------------------------------------------- */

  async consume(
    handler: (message: StreamMessage) => Promise<void>,
  ): Promise<void> {
    this.running = true;
    await this.ensureGroup();

    // Start stale-claim periodic check if enabled
    if (this.options.staleClaimMs && this.options.staleClaimMs > 0) {
      this.startStaleClaimer(handler);
    }

    logger.info(
      { stream: this.streamKey, group: this.groupName, consumer: this.consumerName },
      "Stream consumer started",
    );

    while (this.running) {
      try {
        // Use .call() to bypass ioredis overload ambiguity for XREADGROUP
        const result = (await this.redis.call(
          "XREADGROUP",
          "GROUP",
          this.groupName,
          this.consumerName,
          "BLOCK",
          "5000",
          "COUNT",
          "1",
          "STREAMS",
          this.streamKey,
          ">",
        )) as XReadGroupResult;

        if (!result) continue; // BLOCK timeout, loop again

        for (const [, messages] of result) {
          for (const [id, fields] of messages) {
            const data = this.parseFields(fields);
            await handler({ id, data });
            await this.redis.xack(this.streamKey, this.groupName, id);
          }
        }
      } catch (err) {
        if (!this.running) break;
        logger.error({ err, stream: this.streamKey }, "Stream consumer error");
        await this.sleep(ERROR_BACKOFF_MS);
      }
    }

    logger.info({ stream: this.streamKey }, "Stream consumer stopped");
  }

  stop(): void {
    this.running = false;
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Stale-claim (XPENDING + XCLAIM)                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Start a periodic check for stale pending messages.
   *
   * Uses XPENDING to find messages idle beyond the threshold, then
   * XCLAIM to reassign them to this consumer. Claimed messages are
   * processed immediately (handler + XACK) so they don't stay stuck
   * in the PEL — XREADGROUP ">" only delivers *new* messages, not
   * reclaimed pending entries.
   */
  private startStaleClaimer(
    handler: (message: StreamMessage) => Promise<void>,
  ): void {
    const thresholdMs = this.options.staleClaimMs!;

    this.staleTimer = setInterval(async () => {
      try {
        await this.claimStaleMessages(thresholdMs, handler);
      } catch (err) {
        logger.error({ err, stream: this.streamKey }, "Stale message claim check failed");
      }
    }, STALE_CHECK_INTERVAL_MS);

    logger.debug(
      { stream: this.streamKey, thresholdMs },
      "Stale-claim enabled",
    );
  }

  private async claimStaleMessages(
    thresholdMs: number,
    handler: (message: StreamMessage) => Promise<void>,
  ): Promise<void> {
    // XPENDING <stream> <group> - + <count> → [id, consumer, idleMs, deliveryCount][]
    const pending = (await this.redis.call(
      "XPENDING",
      this.streamKey,
      this.groupName,
      "-",
      "+",
      String(STALE_SCAN_COUNT),
    )) as [string, string, string, string][];

    if (!pending || pending.length === 0) return;

    for (const entry of pending) {
      const id = entry[0]!;
      const idleMs = Number(entry[2]);

      if (idleMs >= thresholdMs) {
        // XCLAIM returns the full message data — process it immediately
        const claimed = (await this.redis.xclaim(
          this.streamKey,
          this.groupName,
          this.consumerName,
          thresholdMs,
          id,
        )) as [string, string[]][];

        for (const [claimedId, fields] of claimed) {
          logger.info(
            { id: claimedId, idleMs: Math.round(idleMs / 1000), stream: this.streamKey },
            "Reclaimed stale message -- processing immediately",
          );
          const data = this.parseFields(fields);
          await handler({ id: claimedId, data });
          await this.redis.xack(this.streamKey, this.groupName, claimedId);
        }
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Internals                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Create the consumer group if it doesn't already exist.
   * BUSYGROUP error means it was already created -- safe to ignore.
   */
  private async ensureGroup(): Promise<void> {
    try {
      await this.redis.xgroup(
        "CREATE",
        this.streamKey,
        this.groupName,
        "0",
        "MKSTREAM",
      );
      logger.debug({ stream: this.streamKey, group: this.groupName }, "Consumer group created");
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("BUSYGROUP")) return;
      throw err;
    }
  }

  /** Convert flat [field, value, field, value, ...] to Record. */
  private parseFields(fields: string[]): Record<string, string> {
    const data: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      const key = fields[i];
      const val = fields[i + 1];
      if (key !== undefined && val !== undefined) {
        data[key] = val;
      }
    }
    return data;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

