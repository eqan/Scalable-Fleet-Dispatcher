/**
 * Pure derived selectors for the HotState (StateResponse).
 *
 * Design principles:
 *   - Pure functions: no side effects, no React dependency, trivially testable.
 *   - DRY: every component uses these instead of duplicating derivation logic.
 *   - Normalized access: `vehiclesById`, `ordersById` convert arrays to maps
 *     for O(1) lookups (used extensively by DnD, map pane, CRUD forms).
 *   - Derived values are never stored -- always computed from the single
 *     authoritative `StateResponse` from TanStack Query.
 */

import type { StateResponse, Vehicle, Order } from "@repo/shared";

/* ------------------------------------------------------------------ */
/*  Indexed lookups (O(1) by id)                                       */
/* ------------------------------------------------------------------ */

/** Vehicle array -> Record keyed by vehicle.id */
export const vehiclesById = (
  state: StateResponse,
): Record<string, Vehicle> => {
  const map: Record<string, Vehicle> = {};
  for (const v of state.vehicles) map[v.id] = v;
  return map;
};

/** Order array -> Record keyed by order.id */
export const ordersById = (
  state: StateResponse,
): Record<string, Order> => {
  const map: Record<string, Order> = {};
  for (const o of state.orders) map[o.id] = o;
  return map;
};

/* ------------------------------------------------------------------ */
/*  Route & assignment helpers                                         */
/* ------------------------------------------------------------------ */

/** Get the ordered route (order IDs) for a specific vehicle. */
export const vehicleRoute = (
  state: StateResponse,
  vehicleId: string,
): string[] => {
  const assignment = state.solution.assignments.find(
    (a) => a.vehicle_id === vehicleId,
  );
  return assignment?.route ?? [];
};

/** Get the full Order objects for a vehicle's route (preserves order). */
export const routeOrders = (
  state: StateResponse,
  vehicleId: string,
): Order[] => {
  const route = vehicleRoute(state, vehicleId);
  const lookup = ordersById(state);
  const result: Order[] = [];
  for (const id of route) {
    const order = lookup[id];
    if (order) result.push(order);
  }
  return result;
};

/** Get full Order objects for all unassigned orders. */
export const unassignedOrders = (state: StateResponse): Order[] => {
  const lookup = ordersById(state);
  const result: Order[] = [];
  for (const id of state.unassignedOrderIds) {
    const order = lookup[id];
    if (order) result.push(order);
  }
  return result;
};

/* ------------------------------------------------------------------ */
/*  Load & capacity calculations                                       */
/* ------------------------------------------------------------------ */

/** Total weight (kg) of all orders assigned to a vehicle. */
export const vehicleLoadKg = (
  state: StateResponse,
  vehicleId: string,
): number => {
  const orders = routeOrders(state, vehicleId);
  let total = 0;
  for (const o of orders) total += o.weight_kg;
  return total;
};

/** Load ratio: current_kg / capacity_kg (0..1+). Over 1.0 = overloaded. */
export const vehicleLoadRatio = (
  state: StateResponse,
  vehicleId: string,
): number => {
  const vehicle = state.vehicles.find((v) => v.id === vehicleId);
  if (!vehicle || vehicle.capacity_kg === 0) return 0;
  return vehicleLoadKg(state, vehicleId) / vehicle.capacity_kg;
};

/** Check if assigning an order to a vehicle would exceed capacity. */
export const wouldExceedCapacity = (
  state: StateResponse,
  vehicleId: string,
  orderWeight: number,
): boolean => {
  const vehicle = state.vehicles.find((v) => v.id === vehicleId);
  if (!vehicle) return true;
  const currentLoad = vehicleLoadKg(state, vehicleId);
  return currentLoad + orderWeight > vehicle.capacity_kg;
};

/* ------------------------------------------------------------------ */
/*  Summary / stats (for header, debug panel, etc.)                    */
/* ------------------------------------------------------------------ */

export interface StateSummary {
  vehicleCount: number;
  orderCount: number;
  unassignedCount: number;
  assignedCount: number;
  rev: number;
}

export const stateSummary = (state: StateResponse): StateSummary => ({
  vehicleCount: state.vehicles.length,
  orderCount: state.orders.length,
  unassignedCount: state.unassignedOrderIds.length,
  assignedCount: state.orders.length - state.unassignedOrderIds.length,
  rev: state.rev,
});
