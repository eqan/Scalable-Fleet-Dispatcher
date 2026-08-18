import { collectDefaultMetrics, Gauge, Histogram, register } from "prom-client";
import type { Request, Response, NextFunction } from "express";

collectDefaultMetrics();

// Low-cardinality labels only (Express route patterns, never raw URLs).
const httpRequestDuration = new Histogram({
  name: "http_request_duration_ms",
  help: "HTTP request duration in milliseconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
});

// Updated from /api/health probes — keeps Grafana dependency panels fresh.
const dependencyLatency = new Gauge({
  name: "dispatch_dependency_latency_ms",
  help: "Latest dependency health-check latency in milliseconds",
  labelNames: ["service"] as const,
});

const dependencyUp = new Gauge({
  name: "dispatch_dependency_up",
  help: "Latest dependency health-check result (1=up, 0=down)",
  labelNames: ["service"] as const,
});

const getRouteLabel = (req: Request): string =>
  req.route?.path ? req.baseUrl + req.route.path : "unmatched";

export const metricsMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const start = Date.now();
  res.on("finish", () => {
    httpRequestDuration.observe(
      {
        method: req.method,
        route: getRouteLabel(req),
        status_code: String(res.statusCode),
      },
      Date.now() - start,
    );
  });
  next();
};

/** Prometheus text exposition — mounted at /metrics (ClusterIP / compose only). */
export const metricsHandler = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
};

export const recordDependencyHealth = (
  service: "redis" | "mongo",
  status: "connected" | "error",
  latencyMs: number,
): void => {
  dependencyLatency.labels(service).set(latencyMs);
  dependencyUp.labels(service).set(status === "connected" ? 1 : 0);
};
