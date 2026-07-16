import pino from "pino";
import { env } from "../config/env.ts";

export const logger = pino({
  level: env.ENV === "production" ? "info" : "debug",
  redact: {
    paths: [
      "password",
      "secret",
      "token",
      "authorization",
      "cookie",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[REDACTED]",
  },
  transport:
    env.ENV !== "production"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});
