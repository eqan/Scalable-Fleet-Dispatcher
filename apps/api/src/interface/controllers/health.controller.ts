import type { Request, Response } from "express";
import { recordDependencyHealth } from "../middleware/metrics.ts";

export interface Pingable {
  ping(): Promise<boolean>;
}

interface ServiceHealth {
  status: "connected" | "error";
  latency_ms: number;
  error?: string;
}

interface HealthResponse {
  status: "healthy" | "degraded";
  timestamp: string;
  uptime_s: number;
  services: {
    redis: ServiceHealth;
    mongo: ServiceHealth;
  };
}

const roundMs = (start: number): number =>
  Math.round((performance.now() - start) * 100) / 100;

const probeService = async (
  fn: () => Promise<unknown>,
): Promise<ServiceHealth> => {
  const start = performance.now();
  try {
    await fn();
    return { status: "connected", latency_ms: roundMs(start) };
  } catch (error) {
    return {
      status: "error",
      latency_ms: roundMs(start),
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
};

export const createHealthController = (deps: {
  draftStore: Pingable;
  durableStore: Pingable;
}) => ({
  // Liveness/startup: never depends on Redis/Mongo.
  live: (_req: Request, res: Response): void => {
    res.status(200).json({
      status: "alive",
      timestamp: new Date().toISOString(),
      uptime_s: Math.round(process.uptime() * 100) / 100,
    });
  },

  // Readiness: 503 when a dependency is down; also feeds Prometheus gauges.
  check: async (_req: Request, res: Response): Promise<void> => {
    const [redisHealth, mongoHealth] = await Promise.all([
      probeService(() => deps.draftStore.ping()),
      probeService(() => deps.durableStore.ping()),
    ]);

    recordDependencyHealth("redis", redisHealth.status, redisHealth.latency_ms);
    recordDependencyHealth("mongo", mongoHealth.status, mongoHealth.latency_ms);

    const allHealthy =
      redisHealth.status === "connected" &&
      mongoHealth.status === "connected";

    const body: HealthResponse = {
      status: allHealthy ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      uptime_s: Math.round(process.uptime() * 100) / 100,
      services: {
        redis: redisHealth,
        mongo: mongoHealth,
      },
    };

    res.status(allHealthy ? 200 : 503).json(body);
  },
});
