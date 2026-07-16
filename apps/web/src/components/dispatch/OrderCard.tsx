/**
 * OrderCard -- pure visual presentation of an order.
 *
 * SRP: This component handles ONLY rendering. It has zero knowledge
 * of DnD, API calls, or state management. It is used:
 *   - Inside SortableOrderCard (the interactive version in columns)
 *   - Inside DragOverlay (the floating preview while dragging)
 *
 * Open/Closed: visual variants (`isSelected`, `isDragging`, `isOverlay`)
 * are toggled via props, no internal logic changes needed.
 */

import type { Order } from "@repo/shared";
import { Badge } from "../shared/Badge.tsx";

interface OrderCardProps {
  order: Order;
  /** Highlight when selected (clicked, or hovered on map). */
  isSelected?: boolean;
  /** Dim the original card while being dragged. */
  isDragging?: boolean;
  /** True when rendered inside DragOverlay (slightly elevated). */
  isOverlay?: boolean;
  /** Click handler for selection. */
  onClick?: () => void;
}

export function OrderCard({
  order,
  isSelected = false,
  isDragging = false,
  isOverlay = false,
  onClick,
}: OrderCardProps) {
  const classes = [
    "order-card",
    isSelected ? "order-card--selected" : "",
    isDragging ? "order-card--dragging" : "",
    isOverlay ? "order-card--overlay" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} onClick={onClick} role="button" tabIndex={0}>
      <div className="order-card__header">
        <span className="order-card__id">{order.id}</span>
        <Badge variant="muted" pill>{order.weight_kg} kg</Badge>
      </div>
      <div className="order-card__details">
        <span className="order-card__meta">
          {order.service_time_min} min
        </span>
        <span className="order-card__meta">
          {order.location.lat.toFixed(3)}, {order.location.lng.toFixed(3)}
        </span>
      </div>
    </div>
  );
}
