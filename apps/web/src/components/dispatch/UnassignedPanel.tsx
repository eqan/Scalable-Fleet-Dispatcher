/**
 * UnassignedPanel -- collapsible droppable zone for unassigned orders.
 *
 * This is the "backlog" column on the left side of the dispatch board.
 * Dragging a card here triggers an "unassign" operation.
 * Dragging a card out of here triggers an "assign" operation.
 *
 * The panel can be collapsed to a slim sidebar to free horizontal space
 * for the vehicle columns and map. Collapse state lives in the UI store.
 *
 * Uses SortableContext so cards can be dragged both in and out smoothly.
 */

import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import type { StateResponse } from "@repo/shared";
import { unassignedOrders } from "../../lib/selectors.ts";
import { UNASSIGNED_CONTAINER, type DropContainerData } from "../../lib/dnd.ts";
import { useUIStore } from "../../stores/ui.store.ts";
import { SortableOrderCard } from "./SortableOrderCard.tsx";
import { EmptyState } from "../shared/EmptyState.tsx";
import { Badge } from "../shared/Badge.tsx";

interface UnassignedPanelProps {
  state: StateResponse;
  selectedOrderId: string | null;
  onSelectOrder: (id: string | null) => void;
}

export function UnassignedPanel({
  state,
  selectedOrderId,
  onSelectOrder,
}: UnassignedPanelProps) {
  const orders = unassignedOrders(state);
  const orderIds = state.unassignedOrderIds;
  const isCollapsed = useUIStore((s) => s.isUnassignedCollapsed);
  const toggle = useUIStore((s) => s.toggleUnassignedPanel);

  const dropData: DropContainerData = {
    type: "container",
    containerId: UNASSIGNED_CONTAINER,
  };

  const { setNodeRef, isOver } = useDroppable({
    id: `droppable-${UNASSIGNED_CONTAINER}`,
    data: dropData,
  });

  /* ---- Collapsed: slim vertical bar with count + expand chevron ---- */
  if (isCollapsed) {
    return (
      <div
        ref={setNodeRef}
        className={`unassigned-panel unassigned-panel--collapsed ${isOver ? "unassigned-panel--over" : ""}`}
      >
        <button
          className="unassigned-panel__toggle"
          onClick={toggle}
          title="Expand unassigned panel"
          aria-label="Expand unassigned panel"
        >
          <ChevronRight />
        </button>
        <div className="unassigned-panel__collapsed-label">
          <span className="unassigned-panel__collapsed-text">Unassigned</span>
          <Badge variant={orders.length > 0 ? "warning" : "success"} pill>
            {orders.length}
          </Badge>
        </div>
      </div>
    );
  }

  /* ---- Expanded: full panel with sortable order list ---- */
  return (
    <div className={`unassigned-panel ${isOver ? "unassigned-panel--over" : ""}`}>
      <div className="unassigned-panel__header">
        <h3 className="unassigned-panel__title">Unassigned</h3>
        <div className="unassigned-panel__header-right">
          <Badge variant={orders.length > 0 ? "warning" : "success"} pill>
            {orders.length}
          </Badge>
          <button
            className="unassigned-panel__toggle"
            onClick={toggle}
            title="Collapse unassigned panel"
            aria-label="Collapse unassigned panel"
          >
            <ChevronLeft />
          </button>
        </div>
      </div>

      <SortableContext
        items={orderIds}
        strategy={verticalListSortingStrategy}
      >
        <div ref={setNodeRef} className="unassigned-panel__body">
          {orders.length === 0 ? (
            <EmptyState
              title="All assigned!"
              description="Every order has a vehicle"
            />
          ) : (
            orders.map((order) => (
              <SortableOrderCard
                key={order.id}
                order={order}
                containerId={UNASSIGNED_CONTAINER}
                isSelected={selectedOrderId === order.id}
                onSelect={() =>
                  onSelectOrder(selectedOrderId === order.id ? null : order.id)
                }
              />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
}

/* ---- Inline chevron SVGs (avoids extra icon dependency) ---- */

function ChevronLeft() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}
