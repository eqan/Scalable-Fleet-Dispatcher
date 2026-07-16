import { AppError } from "../domain/errors.ts";
import { ok, type Result } from "../shared/result.ts";

/**
 * Execute an async operation and capture thrown AppErrors into a Result.
 *
 * - AppError → { ok: false, error }  (expected business errors)
 * - Other errors → re-thrown         (unexpected, caught by error handler middleware)
 *
 * This keeps the Result pattern consistent across all services
 * without repetitive try/catch blocks (DRY).
 */
export const tryCatch = async <T>(
  fn: () => Promise<T>,
): Promise<Result<T, AppError>> => {
  try {
    return ok(await fn());
  } catch (error) {
    if (error instanceof AppError) return { ok: false, error };
    throw error;
  }
};
