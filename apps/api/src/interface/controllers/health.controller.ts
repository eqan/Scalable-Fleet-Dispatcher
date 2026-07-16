import type { Request, Response } from "express";

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
  check: async (_req: Request, res: Response): Promise<void> => {
    const [redisHealth, mongoHealth] = await Promise.all([
      probeService(() => deps.draftStore.ping()),
      probeService(() => deps.durableStore.ping()),
    ]);

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
