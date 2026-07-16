/**
 * Discriminated-union Result type for explicit error handling.
 * Services return Result<T, E> instead of throwing -- makes error
 * flows visible in type signatures and easy to test.
 */
export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Construct a successful result. */
export const ok = <T>(value: T): Result<T, never> => ({
  ok: true,
  value,
});

/** Construct a failure result. */
export const err = <E>(error: E): Result<never, E> => ({
  ok: false,
  error,
});
