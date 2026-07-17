import type { Request, Response } from "express";
import { recordDependencyHealth } from "../middleware/metrics.ts";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Minimal interface for health-checkable services (ISP -- SOLID). */
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

/* ------------------------------------------------------------------ */
/*  DRY helper: measure latency + catch errors for any service check   */
/* ------------------------------------------------------------------ */

const probeService = async (
  fn: () => Promise<unknown>,
): Promise<ServiceHealth> => {
  const start = performance.now();
  try {
    await fn();
    return {
      status: "connected",
      latency_ms: Math.round((performance.now() - start) * 100) / 100,
    };
  } catch (error) {
    return {
      status: "error",
      latency_ms: Math.round((performance.now() - start) * 100) / 100,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
};

/* ------------------------------------------------------------------ */
/*  Controller factory (dependencies injected -- DIP)                  */
/* ------------------------------------------------------------------ */

export const createHealthController = (deps: {
  draftStore: Pingable;
  durableStore: Pingable;
}) => ({
  // Dependency-free — used for liveness/startup so Redis/Mongo blips do not restart pods.
  live: (_req: Request, res: Response): void => {
    res.status(200).json({
      status: "alive",
      timestamp: new Date().toISOString(),
      uptime_s: Math.round(process.uptime() * 100) / 100,
    });
  },

  check: async (_req: Request, res: Response): Promise<void> => {
    const [redisHealth, mongoHealth] = await Promise.all([
      probeService(() => deps.draftStore.ping()),
      probeService(() => deps.durableStore.ping()),
    ]);

    // Feed Prometheus from readiness probes so Grafana sees fresh dep signals
    // without a separate scraper loop (probes already hit this path).
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
