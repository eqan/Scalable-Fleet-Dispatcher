import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../domain/errors.ts";
import { logger } from "../../shared/logger.ts";
import { env } from "../../config/env.ts";

/**
 * Central error handler.
 * Maps AppError instances to structured JSON responses.
 * Unknown errors return a safe 500 with no stack traces in production.
 *
 * Must be registered LAST in the middleware chain (after all routes).
 */
export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      code: err.code,
      message: err.message,
      ...(err.details !== undefined && { details: err.details }),
    });
    return;
  }

  // Unknown / unexpected error
  logger.error({ err }, "Unhandled error");

  res.status(500).json({
    code: "INTERNAL_ERROR",
    message:
      env.ENV === "production"
        ? "Internal server error"
        : err.message,
  });
};
