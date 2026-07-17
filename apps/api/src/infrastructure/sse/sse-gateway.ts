import type { Request, Response } from "express";
import type Redis from "ioredis";
import type {
  IRealtimeGateway,
  StateChangeEvent,
} from "../../domain/ports/realtime.port.ts";
import { logger } from "../../shared/logger.ts";
import { env } from "../../config/env.ts";
import { STREAM_KEYS } from "../../config/redis-keys.ts";

interface QueuedSseEvent {
  id: string;
  payload: string;
}

interface SseClientState {
  res: Response;
  /** False while replay is running; broadcast events are queued. */
  ready: boolean;
  /** Live events buffered during replay to avoid reconnect gaps. */
  queue: QueuedSseEvent[];
}

function compareStreamIds(a: string, b: string): number {
  const parse = (id: string): [number, number] => {
    const [msPart, seqPart] = id.split("-");
    const ms = Number(msPart);
    const seq = Number(seqPart);
    return [Number.isFinite(ms) ? ms : 0, Number.isFinite(seq) ? seq : 0];
  };

  const [leftMs, leftSeq] = parse(a);
  const [rightMs, rightSeq] = parse(b);
  if (leftMs !== rightMs) return leftMs < rightMs ? -1 : 1;
  if (leftSeq !== rightSeq) return leftSeq < rightSeq ? -1 : 1;
  return 0;
}

/**
 * SSE gateway: Redis Stream for Last-Event-ID replay + Pub/Sub (`sse:live`)
 * so every API replica can fan out live events (needed with replicaCount >= 2).
 */
export class SseGateway implements IRealtimeGateway {
  private static readonly MAX_CLIENTS = 256;

  private clients = new Map<string, SseClientState>();
  /** Separate connection — SUBSCRIBE mode cannot share the main Redis socket. */
  private readonly subRedis: Redis;
  private started = false;

  constructor(private readonly redis: Redis) {
    this.subRedis = redis.duplicate();
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    this.subRedis.on("message", (channel: string, message: string) => {
      if (channel !== STREAM_KEYS.sseLive) return;
      this.deliverLivePayload(message);
    });

    await this.subRedis.subscribe(STREAM_KEYS.sseLive);
    logger.info({ channel: STREAM_KEYS.sseLive }, "SSE live pub/sub subscribed");
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    try {
      await this.subRedis.unsubscribe(STREAM_KEYS.sseLive);
    } catch {
      // shutting down
    }
    try {
      await this.subRedis.quit();
    } catch {
      this.subRedis.disconnect();
    }
  }

  addClient(req: Request, res: Response): void {
    if (this.clients.size >= SseGateway.MAX_CLIENTS) {
      logger.warn({ total: this.clients.size }, "SSE connection limit reached");
      res.status(503).json({ code: "SSE_LIMIT", message: "Too many connections" });
      return;
    }

    const clientId = crypto.randomUUID();

    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    const rawLastId = req.headers["last-event-id"] as string | undefined;
    const lastEventId = rawLastId
      ? rawLastId.replace(/[\r\n\0]/g, "").slice(0, 64)
      : null;

    this.clients.set(clientId, {
      res,
      ready: lastEventId === null,
      queue: [],
    });

    req.on("close", () => {
      this.clients.delete(clientId);
      logger.debug(
        { clientId, total: this.clients.size },
        "SSE client disconnected",
      );
    });

    if (lastEventId !== null) {
      void this.replayThenActivate(lastEventId, clientId);
      return;
    }

    res.write(
      `data: ${JSON.stringify({ type: "connected", clientId, lastEventId })}\n\n`,
    );
    logger.debug(
      { clientId, total: this.clients.size },
      "SSE client connected",
    );
  }

  broadcast(event: StateChangeEvent): void {
    const serialized = JSON.stringify(event);

    void this.redis
      .xadd(
        STREAM_KEYS.sseReplay,
        "MAXLEN",
        "~",
        String(env.SSE_REPLAY_BUFFER_SIZE),
        "*",
        "event",
        "state_changed",
        "data",
        serialized,
      )
      .then(async (streamId) => {
        if (!streamId) return;

        const payload = [
          `id: ${streamId}`,
          `event: state_changed`,
          `data: ${serialized}`,
          "",
          "",
        ].join("\n");

        await this.redis.publish(STREAM_KEYS.sseLive, payload);
      })
      .catch((err: unknown) => {
        logger.error({ err }, "Failed to XADD/PUBLISH SSE live event");
      });
  }

  getClientCount(): number {
    return this.clients.size;
  }

  private deliverLivePayload(payload: string): void {
    const idLine = payload.split("\n").find((line) => line.startsWith("id:"));
    const streamId = idLine ? idLine.slice(3).trim() : "";

    for (const [clientId, client] of this.clients) {
      if (!client.ready) {
        if (streamId) client.queue.push({ id: streamId, payload });
        continue;
      }
      try {
        client.res.write(payload);
      } catch {
        this.clients.delete(clientId);
      }
    }
  }

  /**
   * Replay missed stream events, drain anything queued during replay, then go live.
   */
  private async replayThenActivate(
    lastEventId: string,
    clientId: string,
  ): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return; // disconnected before replay started

    let cursor = lastEventId;

    try {
      // Validate that it looks like a Redis Stream ID (e.g. "1707500000000-0")
      if (!/^\d+-\d+$/.test(lastEventId)) {
        logger.warn(
          { clientId, lastEventId },
          "SSE Last-Event-ID is not a valid stream ID — skipping replay",
        );
      } else {
        cursor = await this.replayFromStream(lastEventId, clientId, client.res);
      }
    } catch (err: unknown) {
      logger.error(
        { err, clientId },
        "Failed to replay SSE events from Redis Stream",
      );
      const current = this.clients.get(clientId);
      if (!current) return;
      try {
        current.res.write(
          `event: missed_events\ndata: ${JSON.stringify({
            reason: "replay_failed",
            requestedAfterId: lastEventId,
          })}\n\n`,
        );
      } catch {
        this.clients.delete(clientId);
        return;
      }
    }

    // Drain all events that arrived while replay was running.
    // Dedupe using stream IDs so overlap between replay and queue is harmless.
    while (true) {
      const current = this.clients.get(clientId);
      if (!current) return; // disconnected mid-drain

      const batch = current.queue;
      if (batch.length === 0) break;
      current.queue = [];

      for (const queued of batch) {
        if (compareStreamIds(queued.id, cursor) <= 0) continue;
        try {
          current.res.write(queued.payload);
          cursor = queued.id;
        } catch {
          this.clients.delete(clientId);
          return;
        }
      }
    }

    const current = this.clients.get(clientId);
    if (!current) return;
    current.ready = true;

    try {
      current.res.write(
        `data: ${JSON.stringify({ type: "connected", clientId, lastEventId })}\n\n`,
      );
    } catch {
      this.clients.delete(clientId);
      return;
    }

    logger.debug({ clientId, total: this.clients.size }, "SSE client connected (after replay)");
  }

  private async replayFromStream(
    lastEventId: string,
    clientId: string,
    res: Response,
  ): Promise<string> {
    let cursor = lastEventId;

    // XRANGE from lastEventId to +inf (inclusive start, skip matching entry)
    const entries = await this.redis.xrange(
      STREAM_KEYS.sseReplay,
      lastEventId,
      "+",
    );

    // Skip the first entry if its ID matches lastEventId (we want "after")
    const toReplay =
      entries.length > 0 && entries[0]?.[0] === lastEventId
        ? entries.slice(1)
        : entries;

    // Check if the client missed events (ID too old, no longer in stream)
    if (toReplay.length === 0) {
      const streamLen = await this.redis.xlen(STREAM_KEYS.sseReplay);
      if (streamLen > 0) {
        // Stream has data but nothing after lastEventId → ID may be too old
        const info = await this.redis.xrange(
          STREAM_KEYS.sseReplay,
          "-",
          "+",
          "COUNT",
          1,
        );
        const oldestId = info[0]?.[0] ?? "0-0";

        // Numeric comparison: is lastEventId older than the oldest entry?
        if (compareStreamIds(lastEventId, oldestId) < 0) {
          res.write(
            `event: missed_events\ndata: ${JSON.stringify({
              reason: "replay_buffer_overflow",
              oldestStreamId: oldestId,
              requestedAfterId: lastEventId,
            })}\n\n`,
          );
          logger.warn(
            { clientId, requestedAfterId: lastEventId, oldestId },
            "SSE Last-Event-ID too old for replay stream",
          );
        }
      }
      return cursor;
    }

    // Replay events
    for (const [streamId, fields] of toReplay) {
      const fieldMap = new Map<string, string>();
      for (let i = 0; i < fields.length; i += 2) {
        const key = fields[i];
        const val = fields[i + 1];
        if (key !== undefined && val !== undefined) {
          fieldMap.set(key, val);
        }
      }

      const event = fieldMap.get("event") ?? "state_changed";
      const data = fieldMap.get("data") ?? "{}";

      try {
        res.write(`id: ${streamId}\nevent: ${event}\ndata: ${data}\n\n`);
        cursor = streamId;
      } catch {
        return cursor; // client disconnected mid-replay
      }
    }

    logger.debug(
      { clientId, replayed: toReplay.length, afterId: lastEventId },
      "SSE events replayed from Redis Stream",
    );

    return cursor;
  }
}
