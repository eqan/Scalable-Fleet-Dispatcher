import type { Vehicle, Order, Solution, StateResponse } from "@repo/shared";

/**
 * Port: Hot-state store (Redis abstraction).
 * All high-frequency mutations go through this interface.
 * Implementing class must guarantee atomic state transitions.
 *
 * baseRev (Optimistic Concurrency Control):
 *   When provided, the store checks if the current revision matches.
 *   If it doesn't, a 409 Conflict error is thrown -- the client
 *   must re-fetch state and retry. Pass undefined to skip the check.
 */
export interface IDraftStore {
  /* ---- State retrieval ---- */
  getFullState(): Promise<StateResponse>;
  getRev(): Promise<number | null>;

  /* ---- Vehicle ops ---- */
  setVehicle(vehicle: Vehicle, baseRev?: number): Promise<{ rev: number }>;
  getVehicle(id: string): Promise<Vehicle | null>;
  deleteVehicle(
    id: string,
    baseRev?: number,
  ): Promise<{ unassignedOrderIds: string[]; rev: number }>;

  /* ---- Order ops ---- */
  setOrder(order: Order, baseRev?: number): Promise<{ rev: number }>;
  getOrder(id: string): Promise<Order | null>;
  deleteOrder(id: string, baseRev?: number): Promise<{ rev: number }>;

  /* ---- Assignment ops ---- */
  assignOrder(
    orderId: string,
    vehicleId: string,
    position?: number,
    baseRev?: number,
  ): Promise<{ rev: number }>;

  /* ---- Route ops ---- */
  updateRoute(
    vehicleId: string,
    route: string[],
    baseRev: number,
  ): Promise<{ rev: number }>;

  /* ---- Hydration ---- */
  hydrateFromSnapshot(
    vehicles: Vehicle[],
    orders: Order[],
    solution: Solution,
    rev: number,
  ): Promise<void>;

  /* ---- Diagnostics ---- */
  ping(): Promise<boolean>;
}
