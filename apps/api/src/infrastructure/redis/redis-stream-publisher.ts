import type Redis from "ioredis";
import type { IStreamPublisher } from "../../domain/ports/stream-publisher.port.ts";
import { STREAM_KEYS } from "../../config/redis-keys.ts";

/** Maximum stream length -- approximate trimming for memory safety. */
const MAX_STREAM_LEN = 10_000;

export class RedisStreamPublisher implements IStreamPublisher {
  constructor(private readonly redis: Redis) {}

  async publishOptimizeEvent(
    vehicleId: string,
    requestId: string,
    baseRev: number,
  ): Promise<string> {
    const eventId = await this.redis.xadd(
      STREAM_KEYS.events,
      "MAXLEN",
      "~",
      String(MAX_STREAM_LEN),
      "*",
      "type",
      "optimize_route",
      "vehicleId",
      vehicleId,
      "requestId",
      requestId,
      "baseRev",
      String(baseRev),
      "timestamp",
      String(Date.now()),
    );

    return eventId as string;
  }
}
