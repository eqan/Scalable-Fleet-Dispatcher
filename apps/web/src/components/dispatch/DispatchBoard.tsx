/**
 * DispatchBoard -- the main dispatch view with full drag-and-drop.
 *
 * Architecture:
 *   - DndContext wraps the entire board for cross-container DnD.
 *   - Uses closestCorners collision detection (best for column layouts).
 *   - DragOverlay renders a floating OrderCard during drag.
 *   - onDragEnd resolves the drop operation via pure `resolveDropOperation()`
 *     and fires the mutation via `useAssignMutation`.
 *   - The board handles no data fetching -- it receives `StateResponse`
 *     as a prop (Dependency Inversion: depends on data, not on fetch logic).
 *
 * Layout:
 *   ┌─────────────┬──────────────┬──────────────┬─────────────┐
 *   │ Unassigned  │  Vehicle 1   │  Vehicle 2   │  Vehicle N  │
 *   │  (backlog)  │   (route)    │   (route)    │   (route)   │
 *   └─────────────┴──────────────┴──────────────┴─────────────┘
 */

import { useState, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  pointerWithin,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type CollisionDetection,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { StateResponse, Order } from "@repo/shared";
import {
  type DragItemData,
  UNASSIGNED_CONTAINER,
  resolveDropOperation,
  operationToAssignRequest,
} from "../../lib/dnd.ts";
import { vehicleRoute, wouldExceedCapacity } from "../../lib/selectors.ts";
import { useAssignMutation } from "../../hooks/useAssignMutation.ts";
import { useUIStore } from "../../stores/ui.store.ts";
import { useToastStore } from "../../stores/toast.store.ts";
import { UnassignedPanel } from "./UnassignedPanel.tsx";
import { VehicleColumn } from "./VehicleColumn.tsx";
import { OrderCard } from "./OrderCard.tsx";
import { EmptyState } from "../shared/EmptyState.tsx";

/**
 * Custom collision detection that prioritises droppable *containers*
 * (the vehicle columns / unassigned panel) when the pointer is inside one.
 *
 * Problem: closestCorners compares against every sortable item **and**
 * every droppable zone. When a column is empty it has zero sortable items,
 * so the algorithm favours sortable cards in adjacent columns — making it
 * nearly impossible to drop into an empty column.
 *
 * Fix: first try `pointerWithin` (returns containers the pointer is inside),
 * then fall back to `closestCorners` for fine-grained sorting.
 */
const customCollisionDetection: CollisionDetection = (args) => {
  // 1. Check if the pointer is inside any droppable container
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) {
    return pointerCollisions;
  }

  // 2. Fall back to closestCorners for inter-item sorting
  return closestCorners(args);
};

interface DispatchBoardProps {
  state: StateResponse;
}

export function DispatchBoard({ state }: DispatchBoardProps) {
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [activeContainerId, setActiveContainerId] = useState<string | null>(null);

  const selectedOrderId = useUIStore((s) => s.selectedOrderId);
  const selectOrder = useUIStore((s) => s.selectOrder);
  const optimizingVehicleIds = useUIStore((s) => s.optimizingVehicleIds);
  const addToast = useToastStore((s) => s.addToast);

  const assignMutation = useAssignMutation();

  /* ---- Sensors ---- */
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        // Require 5px of movement before starting drag.
        // This allows clicks (select) vs drags to coexist.
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  /* ---- Drag handlers ---- */

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as DragItemData | undefined;
    if (data?.type === "order") {
      setActiveOrder(data.order);
      setActiveContainerId(data.containerId);
    }
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      setActiveOrder(null);
      setActiveContainerId(null);

      if (!over) return; // dropped outside any droppable

      const activeData = active.data.current as DragItemData | undefined;
      if (!activeData || activeData.type !== "order") return;

      // Determine destination container and index
      const dest = resolveDestination(over.id as string, over.data.current, state);
      if (!dest) return;

      const sourceContainer = activeData.containerId;
      const sourceIndex = getSourceIndex(
        activeData.order.id,
        sourceContainer,
        state,
      );

      const operation = resolveDropOperation(
        activeData.order.id,
        sourceContainer,
        dest.containerId,
        sourceIndex,
        dest.index,
      );

      const request = operationToAssignRequest(operation, state.rev);
      if (request) {
        // Capacity soft-constraint: warn but don't block
        if (
          dest.containerId !== UNASSIGNED_CONTAINER &&
          wouldExceedCapacity(state, dest.containerId, activeData.order.weight_kg)
        ) {
          const vehicle = state.vehicles.find((v) => v.id === dest.containerId);
          addToast({
            variant: "warning",
            title: "Capacity exceeded",
            description: `Adding this order would overload ${vehicle?.name ?? dest.containerId}.`,
          });
        }
        assignMutation.mutate(request);
      }
    },
    [state, assignMutation],
  );

  const handleDragCancel = useCallback(() => {
    setActiveOrder(null);
    setActiveContainerId(null);
  }, []);

  /* ---- Render ---- */

  if (state.vehicles.length === 0 && state.orders.length === 0) {
    return (
      <div className="dispatch-board__empty">
        <EmptyState
          title="No data yet"
          description="Create vehicles and orders from the Master Data panel to get started"
        />
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={customCollisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="dispatch-board">
        <UnassignedPanel
          state={state}
          selectedOrderId={activeContainerId ? null : selectedOrderId}
          onSelectOrder={selectOrder}
        />

        <div className="dispatch-board__vehicles">
          {state.vehicles.map((vehicle) => (
            <VehicleColumn
              key={vehicle.id}
              vehicle={vehicle}
              state={state}
              selectedOrderId={activeContainerId ? null : selectedOrderId}
              onSelectOrder={selectOrder}
              isOptimizing={optimizingVehicleIds.has(vehicle.id)}
            />
          ))}

          {state.vehicles.length === 0 && (
            <div className="dispatch-board__no-vehicles">
              <EmptyState
                title="No vehicles"
                description="Add vehicles to start dispatching"
              />
            </div>
          )}
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeOrder ? (
          <OrderCard order={activeOrder} isOverlay />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/* ------------------------------------------------------------------ */
/*  Pure helpers (no React dependency, testable)                       */
/* ------------------------------------------------------------------ */

/**
 * Determine the destination container + index from the drop target.
 *
 * The `over` element could be:
 *   1. A droppable container (e.g. `droppable-v_001`)
 *   2. A sortable item (another order card)
 *
 * For case 2, we need to figure out which container the target item
 * belongs to, and its index in that container's list.
 */
function resolveDestination(
  overId: string,
  overData: Record<string, unknown> | undefined,
  state: StateResponse,
): { containerId: string; index: number } | null {
  if (!overData) return null;

  const dataType = overData["type"] as string | undefined;

  // Case 1: dropped on a container droppable
  if (dataType === "container") {
    const containerId = overData["containerId"] as string;
    if (containerId === UNASSIGNED_CONTAINER) {
      return { containerId, index: state.unassignedOrderIds.length };
    }
    const route = vehicleRoute(state, containerId);
    return { containerId, index: route.length };
  }

  // Case 2: dropped on another sortable item (order card)
  if (dataType === "order") {
    const targetContainerId = overData["containerId"] as string;
    const targetOrderId = overId;

    if (targetContainerId === UNASSIGNED_CONTAINER) {
      const idx = state.unassignedOrderIds.indexOf(targetOrderId);
      return { containerId: targetContainerId, index: idx >= 0 ? idx : 0 };
    }

    const route = vehicleRoute(state, targetContainerId);
    const idx = route.indexOf(targetOrderId);
    return { containerId: targetContainerId, index: idx >= 0 ? idx : 0 };
  }

  return null;
}

/** Get the index of an order in its source container. */
function getSourceIndex(
  orderId: string,
  containerId: string,
  state: StateResponse,
): number {
  if (containerId === UNASSIGNED_CONTAINER) {
    return Math.max(0, state.unassignedOrderIds.indexOf(orderId));
  }
  const route = vehicleRoute(state, containerId);
  return Math.max(0, route.indexOf(orderId));
}
