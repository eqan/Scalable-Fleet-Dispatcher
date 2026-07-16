/**
 * Badge -- small colored label for status, counts, or tags.
 *
 * Variants map to design-token colors so adding a new variant
 * only requires a CSS rule, no TS changes (Open/Closed).
 */

import type { ReactNode } from "react";

export type BadgeVariant =
  | "default"
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "muted";

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  /** Render as a small pill (e.g. count indicator). */
  pill?: boolean;
}

export function Badge({ children, variant = "default", pill = false }: BadgeProps) {
  const classes = [
    "badge",
    `badge--${variant}`,
    pill ? "badge--pill" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return <span className={classes}>{children}</span>;
}
