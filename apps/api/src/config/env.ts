import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3000),
  ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  // Redis
  REDIS_HOST: z.string().min(1),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().default(""),
  REDIS_USERNAME: z.string().default(""),
  REDIS_DB: z.coerce.number().default(0),

  // MongoDB
  MONGO_URI: z.string().min(1),
  MONGO_DATABASE: z.string().min(1),

  // CORS (comma-separated origins or "*")
  CORS_ORIGIN: z.string().default("*"),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
  RATE_LIMIT_GENERAL_MAX: z.coerce.number().default(100),
  RATE_LIMIT_MUTATION_MAX: z.coerce.number().default(50),

  // Performance knobs
  REHYDRATION_GUARD_CHECK_MS: z.coerce.number().default(1_000),
  SSE_REPLAY_BUFFER_SIZE: z.coerce.number().int().min(1).default(256),
  STATE_READ_VALIDATE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "Invalid environment variables:",
    parsed.error.flatten().fieldErrors,
  );
  process.exit(1);
}

// ---- Production safety checks ----
if (parsed.data.ENV === "production") {
  const warnings: string[] = [];
  if (parsed.data.CORS_ORIGIN === "*")
    warnings.push("CORS_ORIGIN is set to '*' — restrict to explicit origins in production");
  if (!parsed.data.REDIS_PASSWORD)
    warnings.push("REDIS_PASSWORD is empty — Redis is unauthenticated");
  if (warnings.length) {
    for (const w of warnings) console.warn(`!!!ENV WARNING: ${w}`);
  }
}

export const env = Object.freeze(parsed.data);
