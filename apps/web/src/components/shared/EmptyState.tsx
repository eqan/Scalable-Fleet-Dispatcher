/**
 * EmptyState -- generic "nothing here" placeholder.
 *
 * Reusable across every panel that may have zero items:
 *   - UnassignedPanel when all orders are assigned
 *   - VehicleColumn when the route is empty
 *   - Future: Master Data tables, search results, etc.
 *
 * Open/Closed: accepts `icon`, `title`, `description` props so
 * every consumer can customise without modifying this component.
 */

import type { ReactNode } from "react";

interface EmptyStateProps {
  /** Optional icon/emoji rendered above the title. */
  icon?: ReactNode;
  /** Short headline. */
  title: string;
  /** Optional secondary description. */
  description?: string;
}

export function EmptyState({ icon, title, description }: EmptyStateProps) {
  return (
    <div className="empty-state">
      {icon && <span className="empty-state__icon">{icon}</span>}
      <p className="empty-state__title">{title}</p>
      {description && (
        <p className="empty-state__desc">{description}</p>
      )}
    </div>
  );
}
