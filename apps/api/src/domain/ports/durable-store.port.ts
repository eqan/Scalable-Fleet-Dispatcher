import type { Vehicle, Order, Solution } from "@repo/shared";

export interface Snapshot {
  vehicles: Vehicle[];
  orders: Order[];
  solution: Solution;
  savedAt: Date;
  rev: number;
}

/**
 * Port: Durable store (MongoDB abstraction).
 * Only written to on startup seed and explicit "Save Plan" action.
 */
export interface IDurableStore {
  // Existence checks (for empty-only seeding)
  hasVehicles(): Promise<boolean>;
  hasOrders(): Promise<boolean>;

  // Seeding (only called when collections are empty)
  seedVehicles(vehicles: Vehicle[]): Promise<void>;
  seedOrders(orders: Order[]): Promise<void>;
  seedSnapshot(vehicles: Vehicle[], orders: Order[], solution: Solution): Promise<void>;

  // Reading
  getVehicles(): Promise<Vehicle[]>;
  getOrders(): Promise<Order[]>;
  getLatestSolution(): Promise<Solution | null>;
  getLatestSnapshotRev(): Promise<number>;
  /** Load the full latest snapshot as a single document (atomic read for hydration). */
  getLatestSnapshot(): Promise<Snapshot | null>;

  // Saving 
  saveSnapshot(snapshot: Snapshot): Promise<void>;

  // Diagnostics
  ping(): Promise<boolean>;
}
