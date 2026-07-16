/**
 * SortableOrderCard -- DnD behavior wrapper around OrderCard.
 *
 * SRP: This component handles ONLY the @dnd-kit sortable integration.
 * All visual rendering is delegated to OrderCard (presentation).
 *
 * - Attaches `useSortable` with typed DragItemData
 * - Applies CSS transform/transition from @dnd-kit
 * - Passes `isDragging` down to OrderCard for visual dimming
 */

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Order } from "@repo/shared";
import { OrderCard } from "./OrderCard.tsx";
import type { DragItemData } from "../../lib/dnd.ts";

interface SortableOrderCardProps {
  order: Order;
  /** The container this card belongs to (vehicleId or "UNASSIGNED"). */
  containerId: string;
  isSelected?: boolean;
  onSelect?: () => void;
}

export function SortableOrderCard({
  order,
  containerId,
  isSelected = false,
  onSelect,
}: SortableOrderCardProps) {
  const dragData: DragItemData = {
    type: "order",
    order,
    containerId,
  };

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: order.id,
    data: dragData,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <OrderCard
        order={order}
        isDragging={isDragging}
        isSelected={isSelected}
        onClick={onSelect}
      />
    </div>
  );
}
