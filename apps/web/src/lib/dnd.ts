/**
 * DnD types and utilities -- shared constants for the dispatch board.
 *
 * Design:
 *   - All DnD data contracts live here so components and the
 *     onDragEnd handler agree on shape (DRY + type-safe).
 *   - Pure functions: resolveDropOperation() determines the API call
 *     from raw DnD event data without any React dependency.
 */

import type { Order } from "@repo/shared";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** Sentinel ID for the unassigned orders panel. */
export const UNASSIGNED_CONTAINER = "UNASSIGNED" as const;

/* ------------------------------------------------------------------ */
/*  DnD data contracts                                                 */
/* ------------------------------------------------------------------ */

/** Attached to every draggable OrderCard via `useSortable({ data })`. */
export interface DragItemData {
  type: "order";
  order: Order;
  /** The container this card belongs to (vehicleId or "UNASSIGNED"). */
  containerId: string;
}

/** Attached to every droppable container (VehicleColumn / UnassignedPanel). */
export interface DropContainerData {
  type: "container";
  containerId: string;
}

/* ------------------------------------------------------------------ */
/*  Operation types (what the UI intends to do)                        */
/* ------------------------------------------------------------------ */

export type DropOperation =
  | { kind: "assign"; orderId: string; vehicleId: string; position: number }
  | { kind: "unassign"; orderId: string }
  | { kind: "reassign"; orderId: string; vehicleId: string; position: number }
  | { kind: "reorder"; orderId: string; vehicleId: string; position: number }
  | { kind: "noop" };

/* ------------------------------------------------------------------ */
/*  Resolver: raw DnD data → typed operation                           */
/* ------------------------------------------------------------------ */

/**
 * Given the source/destination container IDs and positions, determines
 * the exact operation to send to `POST /api/assign`.
 *
 * Rules:
 *   - Same container, same index → noop
 *   - UNASSIGNED → vehicle → assign
 *   - vehicle → UNASSIGNED → unassign
 *   - vehicle A → vehicle B → reassign
 *   - vehicle A → vehicle A (different index) → reorder
 */
export function resolveDropOperation(
  orderId: string,
  sourceContainer: string,
  destContainer: string,
  sourceIndex: number,
  destIndex: number,
): DropOperation {
  // Dropped back in place
  if (sourceContainer === destContainer && sourceIndex === destIndex) {
    return { kind: "noop" };
  }

  // Dropped into the unassigned panel
  if (destContainer === UNASSIGNED_CONTAINER) {
    if (sourceContainer === UNASSIGNED_CONTAINER) return { kind: "noop" };
    return { kind: "unassign", orderId };
  }

  // Dropped into a vehicle column
  const isFromUnassigned = sourceContainer === UNASSIGNED_CONTAINER;
  const isSameVehicle = sourceContainer === destContainer;

  if (isFromUnassigned) {
    return { kind: "assign", orderId, vehicleId: destContainer, position: destIndex };
  }

  if (isSameVehicle) {
    return { kind: "reorder", orderId, vehicleId: destContainer, position: destIndex };
  }

  return { kind: "reassign", orderId, vehicleId: destContainer, position: destIndex };
}

/**
 * Converts a DropOperation into the shape expected by `api.assign()`.
 * Returns null for noop operations.
 */
export function operationToAssignRequest(
  op: DropOperation,
  baseRev?: number,
): { orderId: string; vehicleId: string; position?: number; baseRev?: number } | null {
  switch (op.kind) {
    case "noop":
      return null;
    case "unassign":
      return { orderId: op.orderId, vehicleId: UNASSIGNED_CONTAINER, baseRev };
    case "assign":
    case "reassign":
    case "reorder":
      return {
        orderId: op.orderId,
        vehicleId: op.vehicleId,
        position: op.position,
        baseRev,
      };
  }
}
