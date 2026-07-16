import type { ZodSchema } from "zod";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../domain/errors.ts";

/**
 * Generic Zod validation middleware factory (DRY).
 * Validates body / params / query against the supplied schemas.
 * On success, replaces req fields with parsed (coerced) data.
 *
 * Usage:
 *   router.post('/foo', validate({ body: FooSchema }), handler);
 */
interface ValidationSpec {
  body?: ZodSchema;
  params?: ZodSchema;
  query?: ZodSchema;
}

type ValidationTarget = keyof ValidationSpec;

export const validate = (spec: ValidationSpec) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const targets: ValidationTarget[] = ["body", "params", "query"];

    for (const target of targets) {
      const schema = spec[target];
      if (!schema) continue;

      const result = schema.safeParse(req[target]);

      if (!result.success) {
        throw AppError.validation(
          `Invalid ${target}`,
          result.error.flatten().fieldErrors,
        );
      }

      // Replace with parsed/coerced data.
      // Bun's Express shim may make req.query/req.params readonly,
      // so we use Object.defineProperty as a safe cross-runtime approach.
      Object.defineProperty(req, target, {
        value: result.data,
        writable: true,
        configurable: true,
      });
    }

    next();
  };
};
