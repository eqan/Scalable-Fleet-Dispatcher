import express from "express";
import type { Container } from "./config/container.ts";
import {
  securityHeaders,
  corsMiddleware,
  generalLimiter,
  mutationLimiter,
} from "./interface/middleware/security.ts";
import { metricsMiddleware, metricsHandler } from "./interface/middleware/metrics.ts";
import { createRehydrationGuard } from "./interface/middleware/rehydration-guard.ts";
import { errorHandler } from "./interface/middleware/error-handler.ts";
import { createHealthRoutes } from "./interface/routes/health.routes.ts";
import { createStateRoutes } from "./interface/routes/state.routes.ts";
import { createAssignmentRoutes } from "./interface/routes/assignment.routes.ts";
import { createVehicleRoutes } from "./interface/routes/vehicle.routes.ts";
import { createOrderRoutes } from "./interface/routes/order.routes.ts";
import { createOptimizationRoutes } from "./interface/routes/optimization.routes.ts";
import { createEventsRoutes } from "./interface/routes/events.routes.ts";
import { createSaveRoutes } from "./interface/routes/save.routes.ts";

/**
 * Express application factory.
 *
 * Accepts the fully-wired Container (Composition Root pattern).
 * Each route factory receives only the ports it needs (ISP + DIP).
 *
 * Middleware order:
 *   0. Prometheus metrics (records duration — ~0.01 ms overhead)
 *   0b. /metrics endpoint (internal-only, not under /api, not proxied)
 *   1. Security headers (Helmet) + CORS
 *   2. Body parsing
 *   3. General rate limiter (all /api/*)
 *   4. Health & SSE routes (bypass rehydration guard)
 *   5. Auto-rehydration guard (detects cold Redis → rehydrate from Mongo)
 *   6. Mutation rate limiter (heavy endpoints only)
 *   7. Data routes
 *   8. Central error handler (must be last)
 */
export const createServer = (container: Container) => {
  const app = express();

  app.set("trust proxy", 1);

  // ---- 0. Prometheus metrics (must be first to capture full lifecycle) ----
  //   ~0.01 ms overhead: one Date.now() + one "finish" listener per request.
  //   Histogram observation runs AFTER the response is flushed.
  app.use(metricsMiddleware);

  //   Internal-only endpoint — outside /api/* so nginx never proxies it.
  //   Only reachable within the Docker network by Prometheus.
  app.get("/metrics", metricsHandler);

  // ---- 1. Security middleware (global) ----
  app.use(securityHeaders);
  app.use(corsMiddleware);

  // ---- 2. Body parsing (2 MB limit to prevent large-payload DoS) ----
  app.use(express.json({ limit: "2mb" }));

  // ---- 3. General rate limiter ----
  app.use("/api", generalLimiter);

  // ---- 4. Routes that bypass rehydration guard ----
  //   Health check must always work (even if Redis is cold).
  //   SSE opens a persistent connection -- guard would block it.
  app.use("/api", createHealthRoutes(container));
  app.use("/api", createEventsRoutes(container.realtimeGateway));

  // ---- 5. Auto-rehydration guard ----
  //   Detects missing ws:default:rev → acquires lock → rehydrates from Mongo.
  //   Only runs for data routes (health/events already handled above).
  //   Overhead: one O(1) Redis GET per request.
  app.use("/api", createRehydrationGuard({
    draftStore: container.draftStore,
    durableStore: container.durableStore,
    redis: container.redis,
  }));

  // ---- 6. Mutation rate limiter (heavy endpoints) ----
  app.use("/api/assign", mutationLimiter);
  app.use("/api/optimize", mutationLimiter);
  app.use("/api/save", mutationLimiter);

  // ---- 7. Data routes ----
  const mutationDeps = {
    draftStore: container.draftStore,
    gateway: container.realtimeGateway,
  };

  app.use("/api", createStateRoutes(container.draftStore));
  app.use("/api", createAssignmentRoutes(mutationDeps));
  app.use("/api", createVehicleRoutes(mutationDeps));
  app.use("/api", createOrderRoutes(mutationDeps));
  app.use("/api", createOptimizationRoutes({
    draftStore: container.draftStore,
    streamPublisher: container.streamPublisher,
  }));
  app.use("/api", createSaveRoutes({
    draftStore: container.draftStore,
    durableStore: container.durableStore,
    gateway: container.realtimeGateway,
  }));

  // ---- 8. Central error handler (must be last) ----
  app.use(errorHandler);

  return app;
};
