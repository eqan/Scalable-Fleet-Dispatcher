import type { Response, NextFunction } from "express";
import type { Result } from "../shared/result.ts";

/**
 * Send a Result<T, E> as an HTTP response (DRY controller helper).
 *
 * - Success → res.status(status).json(value)
 * - Failure → forward error to Express error handler via next()
 *
 * Eliminates the repeated if/else unwrap pattern in every controller method.
 */
export const sendResult = <T>(
  result: Result<T, Error>,
  res: Response,
  next: NextFunction,
  status = 200,
): void => {
  if (!result.ok) {
    next(result.error);
    return;
  }
  res.status(status).json(result.value);
};
