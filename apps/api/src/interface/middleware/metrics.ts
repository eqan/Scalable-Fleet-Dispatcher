import { collectDefaultMetrics, Histogram, register } from "prom-client";
import type { Request, Response, NextFunction } from "express";

/* ------------------------------------------------------------------ */
/*  Default process metrics (CPU, memory, GC, event loop)              */
/* ------------------------------------------------------------------ */

/**
 * Collect Node.js process metrics on a background timer (every 10 s).
 * Zero per-request overhead — never touches the hot path.
 */
collectDefaultMetrics();

/* ------------------------------------------------------------------ */
/*  HTTP request duration histogram                                    */
/* ------------------------------------------------------------------ */

/**
 * Histogram that powers all four Grafana dashboard panels:
 *   - Request Duration Heatmap   (bucket distribution)
 *   - Request Count by Route     (_count series)
 *   - Error Rate per Route       (_count filtered by status_code)
 *
 * Labels are intentionally minimal (method, route, status_code)
 * to keep cardinality bounded.  Route labels use Express route
 * patterns (e.g. "/api/orders/:id"), never raw URLs.
 *
 * Buckets are tuned for typical API latency in milliseconds.
 */
const httpRequestDuration = new Histogram({
  name: "http_request_duration_ms",
  help: "HTTP request duration in milliseconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
});

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Derive a low-cardinality route label from the matched Express route.
 *
 * - Matched routes  → `req.baseUrl + req.route.path`  (e.g. "/api/state")
 * - Unmatched paths → `"unmatched"` (prevents label explosion from
 *   bot scans, typos, or enumeration attacks).
 */
const getRouteLabel = (req: Request): string => {
  if (req.route?.path) {
    return req.baseUrl + req.route.path;
  }
  return "unmatched";
};

/* ------------------------------------------------------------------ */
/*  Middleware                                                         */
/* ------------------------------------------------------------------ */

/**
 * Express middleware that records request duration into a Prometheus
 * histogram.
 *
 * Performance impact: ~0.01 ms per request.
 *   - Synchronous hot path: one `Date.now()` + one event listener.
 *   - Histogram observation runs AFTER the response is flushed
 *     (`res` "finish" event) — never blocks the client.
 */
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

/* ------------------------------------------------------------------ */
/*  /metrics endpoint handler                                          */
/* ------------------------------------------------------------------ */

/**
 * Returns all collected metrics in Prometheus text exposition format.
 *
 * This endpoint is mounted at `/metrics` (outside `/api/*`) so it is:
 *   - NOT proxied through nginx (internal-only)
 *   - NOT subject to rate limiting or rehydration guards
 *   - Only reachable within the Docker network by Prometheus
 */
export const metricsHandler = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
};
