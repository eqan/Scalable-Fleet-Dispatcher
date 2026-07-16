/**
 * VehicleColumn -- droppable column for a single vehicle's route.
 *
 * Responsibilities:
 *   - Renders vehicle header (name, capacity bar, optimize button)
 *   - Wraps route items in a SortableContext for reordering
 *   - Uses useDroppable as a fallback target for empty columns
 *   - Shows EmptyState when route is empty
 *
 * Data flow:
 *   VehicleColumn receives the full StateResponse and vehicleId.
 *   It derives route orders + capacity via pure selectors (DRY).
 */

import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import type { StateResponse, Vehicle } from "@repo/shared";
import {
  vehicleRoute,
  routeOrders,
  vehicleLoadKg,
} from "../../lib/selectors.ts";
import type { DropContainerData } from "../../lib/dnd.ts";
import { useOptimizeMutation } from "../../hooks/useOptimizeMutation.ts";
import { useDeleteVehicle } from "../../hooks/useCrudMutations.ts";
import { SortableOrderCard } from "./SortableOrderCard.tsx";
import { CapacityBar } from "./CapacityBar.tsx";
import { EmptyState } from "../shared/EmptyState.tsx";
import { Badge } from "../shared/Badge.tsx";

interface VehicleColumnProps {
  vehicle: Vehicle;
  state: StateResponse;
  selectedOrderId: string | null;
  onSelectOrder: (id: string | null) => void;
  isOptimizing?: boolean;
}

export function VehicleColumn({
  vehicle,
  state,
  selectedOrderId,
  onSelectOrder,
  isOptimizing = false,
}: VehicleColumnProps) {
  const route = vehicleRoute(state, vehicle.id);
  const orders = routeOrders(state, vehicle.id);
  const loadKg = vehicleLoadKg(state, vehicle.id);
  const optimizeMutation = useOptimizeMutation();
  const deleteMutation = useDeleteVehicle();

  const canOptimize = route.length >= 2 && !isOptimizing;

  const handleDropVehicle = () => {
    if (!confirm(`Remove vehicle "${vehicle.name}" from the solution?`)) return;
    deleteMutation.mutate({ id: vehicle.id, baseRev: state.rev });
  };

  const dropData: DropContainerData = {
    type: "container",
    containerId: vehicle.id,
  };

  const { setNodeRef, isOver } = useDroppable({
    id: `droppable-${vehicle.id}`,
    data: dropData,
  });

  const handleOptimize = () => {
    if (!canOptimize) return;
    optimizeMutation.mutate({ vehicleId: vehicle.id });
  };

  return (
    <div className={`vehicle-column ${isOver ? "vehicle-column--over" : ""}`}>
      <div className="vehicle-column__header">
        <div className="vehicle-column__title-row">
          <h3 className="vehicle-column__name">{vehicle.name}</h3>
          <Badge variant={route.length > 0 ? "primary" : "muted"} pill>
            {route.length}
          </Badge>
          <div className="vehicle-column__actions">
            <button
              className={`btn-icon ${isOptimizing ? "btn-icon--active" : ""}`}
              onClick={handleOptimize}
              disabled={!canOptimize}
              title={
                isOptimizing
                  ? "Optimizing route..."
                  : route.length < 2
                    ? "Need 2+ orders to optimize"
                    : "Optimize route order"
              }
              aria-label={`Optimize route for ${vehicle.name}`}
            >
              {isOptimizing ? (
                <div className="spinner spinner--sm" />
              ) : (
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
                  <path d="M12 20V10" />
                  <path d="M18 20V4" />
                  <path d="M6 20v-4" />
                </svg>
              )}
            </button>
            <button
              className="btn-icon btn-icon--danger"
              onClick={handleDropVehicle}
              disabled={deleteMutation.isPending}
              title="Drop vehicle from solution"
              aria-label={`Drop ${vehicle.name} from solution`}
            >
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
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
            </button>
          </div>
        </div>
        <CapacityBar currentKg={loadKg} capacityKg={vehicle.capacity_kg} />
      </div>

      <SortableContext
        items={route}
        strategy={verticalListSortingStrategy}
      >
        <div ref={setNodeRef} className="vehicle-column__body">
          {orders.length === 0 ? (
            <EmptyState
              title="No orders"
              description="Drop orders here to assign"
            />
          ) : (
            orders.map((order) => (
              <SortableOrderCard
                key={order.id}
                order={order}
                containerId={vehicle.id}
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
