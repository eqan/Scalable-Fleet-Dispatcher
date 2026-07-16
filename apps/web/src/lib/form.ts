/**
 * Form utilities -- custom Zod resolver for React Hook Form.
 *
 * Why a custom resolver instead of @hookform/resolvers/zod?
 *   - Full control over error mapping (no hidden behaviour)
 *   - Guaranteed compatibility with Zod v4 (no third-party coupling)
 *   - Supports nested fields (e.g. `start_location.lat`) via dot-path
 *   - Zero extra dependencies (DRY: Zod is already installed)
 *
 * Open/Closed: works with ANY Zod schema -- Vehicle, Order, or future entities.
 */

/* ------------------------------------------------------------------ */
/*  Zod-like schema interface (compatible with Zod v4)                 */
/* ------------------------------------------------------------------ */

interface ZodLikeIssue {
  path: PropertyKey[];
  message: string;
}

interface ZodLikeSchema {
  safeParse(data: unknown):
    | { success: true; data: unknown }
    | { success: false; error: { issues: ZodLikeIssue[] } };
}

/* ------------------------------------------------------------------ */
/*  Resolver                                                           */
/* ------------------------------------------------------------------ */

/**
 * Creates a React Hook Form resolver from any Zod schema.
 *
 * Note: The return type is intentionally `any` because RHF's `Resolver`
 * generic is deeply coupled to the form's field types, and bridging
 * Zod v4's type system to RHF's at compile time is impractical.
 * Runtime validation by Zod is the actual safety net here.
 *
 * Usage:
 * ```ts
 * const { register, handleSubmit } = useForm({
 *   resolver: zodResolver(VehicleSchema),
 * });
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function zodResolver(schema: ZodLikeSchema, numericFields?: string[]): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (values: any) => {
    // Coerce numeric string values → numbers BEFORE Zod validation.
    // HTML inputs always return strings; without this coercion Zod's
    // z.number() rejects them before handleSubmit's callback runs.
    const coerced = numericFields
      ? coerceNumbers(values as Record<string, unknown>, numericFields)
      : values;

    const result = schema.safeParse(coerced);

    if (result.success) {
      return { values: result.data, errors: {} };
    }

    // Convert Zod issues → RHF FieldErrors (supports dot-path nesting)
    const errors: Record<string, unknown> = {};
    for (const issue of result.error.issues) {
      const pathStr = issue.path.map(String).join(".");
      if (pathStr && !(pathStr in errors)) {
        setNestedError(errors, issue.path.map(String), issue.message);
      }
    }

    return { values: {}, errors };
  };
}

/** Recursively set a nested error by path segments. */
function setNestedError(
  target: Record<string, unknown>,
  path: string[],
  message: string,
): void {
  if (path.length === 0) return;

  if (path.length === 1) {
    target[path[0]!] = { type: "validation", message };
    return;
  }

  const key = path[0]!;
  if (!(key in target) || typeof target[key] !== "object") {
    target[key] = {};
  }
  setNestedError(target[key] as Record<string, unknown>, path.slice(1), message);
}

/* ------------------------------------------------------------------ */
/*  Numeric coercion helper                                            */
/* ------------------------------------------------------------------ */

/**
 * Coerce form string values to numbers for numeric fields.
 *
 * HTML inputs always return strings. This helper converts known
 * numeric fields before Zod validation. DRY: called once per form
 * submit instead of adding `valueAsNumber` to every input.
 */
export function coerceNumbers<T extends Record<string, unknown>>(
  data: T,
  numericFields: string[],
): T {
  const result = { ...data };
  for (const field of numericFields) {
    if (field.includes(".")) {
      const parts = field.split(".");
      let obj = result as Record<string, unknown>;
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i]!;
        if (typeof obj[part] === "object" && obj[part] !== null) {
          obj[part] = { ...(obj[part] as Record<string, unknown>) };
          obj = obj[part] as Record<string, unknown>;
        }
      }
      const lastKey = parts[parts.length - 1]!;
      const val = obj[lastKey];
      if (typeof val === "string") {
        obj[lastKey] = val === "" ? undefined : Number(val);
      }
    } else {
      const val = result[field];
      if (typeof val === "string") {
        (result as Record<string, unknown>)[field] = val === "" ? undefined : Number(val);
      }
    }
  }
  return result;
}
