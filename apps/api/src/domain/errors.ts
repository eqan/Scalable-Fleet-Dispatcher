/**
 * Centralized error hierarchy.
 * All domain/application errors extend AppError.
 * The error handler middleware maps these to HTTP responses.
 */
export enum ErrorCode {
  VALIDATION = "VALIDATION_ERROR",
  NOT_FOUND = "NOT_FOUND",
  CONFLICT = "CONFLICT",
  CAPACITY_EXCEEDED = "CAPACITY_EXCEEDED",
  INTERNAL = "INTERNAL_ERROR",
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
}

export class AppError extends Error {
  public override readonly name = "AppError" as const;

  private constructor(
    public readonly code: ErrorCode,
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }

  // Static factories (DRY construction)

  static validation(message: string, details?: unknown): AppError {
    return new AppError(ErrorCode.VALIDATION, 422, message, details);
  }

  static notFound(resource: string, id?: string): AppError {
    const msg = id ? `${resource} '${id}' not found` : `${resource} not found`;
    return new AppError(ErrorCode.NOT_FOUND, 404, msg);
  }

  static conflict(message: string): AppError {
    return new AppError(ErrorCode.CONFLICT, 409, message);
  }

  static internal(message: string): AppError {
    return new AppError(ErrorCode.INTERNAL, 500, message);
  }

  static capacityExceeded(message: string): AppError {
    return new AppError(ErrorCode.CAPACITY_EXCEEDED, 422, message);
  }

  static serviceUnavailable(message: string): AppError {
    return new AppError(ErrorCode.SERVICE_UNAVAILABLE, 503, message);
  }
}
