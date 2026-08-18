import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { env } from "../../config/env.ts";

/* ------------------------------------------------------------------ */
/*  Security headers (Helmet)                                          */
/* ------------------------------------------------------------------ */

/**
 * Helmet sets various HTTP security headers:
 * - X-Content-Type-Options: nosniff
 * - Strict-Transport-Security (HSTS)
 * - X-Frame-Options: SAMEORIGIN
 * - Content-Security-Policy (default)
 * - etc.
 */
export const securityHeaders = helmet();

/* ------------------------------------------------------------------ */
/*  CORS                                                               */
/* ------------------------------------------------------------------ */

/**
 * CORS middleware.
 * Supports a single wildcard "*" or a comma-separated allowlist
 * (e.g. "https://app.dispatch.com,http://localhost:5173").
 */
export const corsMiddleware = cors({
  origin: env.CORS_ORIGIN === "*" ? "*" : env.CORS_ORIGIN.split(","),
  credentials: env.CORS_ORIGIN !== "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Last-Event-ID"],
});

/* ------------------------------------------------------------------ */
/*  Rate limiting                                                      */
/* ------------------------------------------------------------------ */

/** Relaxed limit in test mode to avoid blocking automated tests. */
const isTest = env.ENV === "test";

/**
 * General API rate limiter (test mode is relaxed).
 * Applied to all /api/* routes.
 */
export const generalLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: isTest ? 100_000 : env.RATE_LIMIT_GENERAL_MAX,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { code: "RATE_LIMIT", message: "Too many requests, please try again later" },
  // trust proxy is set in server.ts; skip the runtime check that
  // throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR on Express 5 + Bun.
  validate: { xForwardedForHeader: false },
});

/**
 * Stricter limiter for heavy mutation / computation endpoints.
 * Applied selectively to /api/assign, /api/optimize, /api/save.
 */
export const mutationLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: isTest ? 100_000 : env.RATE_LIMIT_MUTATION_MAX,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { code: "RATE_LIMIT", message: "Too many mutation requests, please try again later" },
  validate: { xForwardedForHeader: false },
});
