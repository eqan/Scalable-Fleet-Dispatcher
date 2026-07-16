import type { Db, Collection } from "mongodb";
import type { IDurableStore, Snapshot } from "../../domain/ports/durable-store.port.ts";
import type { Vehicle, Order, Solution } from "@repo/shared";
import { VehicleSchema, OrderSchema, SolutionSchema } from "@repo/shared";
import { logger } from "../../shared/logger.ts";

/* ------------------------------------------------------------------ */
/*  Collection names (single source of truth)                          */
/* ------------------------------------------------------------------ */

const COLLECTIONS = {
  vehicles: "vehicles",
  orders: "orders",
  snapshots: "snapshots",
} as const;

/* ------------------------------------------------------------------ */
/*  Implementation                                                     */
/* ------------------------------------------------------------------ */

export class MongoDurableStore implements IDurableStore {
  private readonly vehicles: Collection;
  private readonly orders: Collection;
  private readonly snapshots: Collection;

  constructor(private readonly db: Db) {
    this.vehicles = db.collection(COLLECTIONS.vehicles);
    this.orders = db.collection(COLLECTIONS.orders);
    this.snapshots = db.collection(COLLECTIONS.snapshots);
  }

  /* ========================= Index setup ============================ */

  /** Create indexes for query performance. Idempotent. */
  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.vehicles.createIndex({ id: 1 }, { unique: true }),
      this.orders.createIndex({ id: 1 }, { unique: true }),
      this.snapshots.createIndex({ savedAt: -1, rev: -1 }),
    ]);
    logger.debug("MongoDB indexes ensured");
  }

  /* ========================= Existence checks ======================== */

  async hasVehicles(): Promise<boolean> {
    return (await this.vehicles.countDocuments({}, { limit: 1 })) > 0;
  }

  async hasOrders(): Promise<boolean> {
    return (await this.orders.countDocuments({}, { limit: 1 })) > 0;
  }

  /* ========================= Seeding ================================ */

  async seedVehicles(vehicles: Vehicle[]): Promise<void> {
    if (await this.hasVehicles()) {
      logger.debug("Vehicles already exist, skipping seed");
      return;
    }
    await this.bulkUpsert(this.vehicles, vehicles);
    logger.info({ count: vehicles.length }, "Seeded vehicles");
  }

  async seedOrders(orders: Order[]): Promise<void> {
    if (await this.hasOrders()) {
      logger.debug("Orders already exist, skipping seed");
      return;
    }
    await this.bulkUpsert(this.orders, orders);
    logger.info({ count: orders.length }, "Seeded orders");
  }

  async seedSnapshot(vehicles: Vehicle[], orders: Order[], solution: Solution): Promise<void> {
    // Only seed if no snapshots exist (first run)
    const existing = await this.snapshots.countDocuments({}, { limit: 1 });
    if (existing > 0) {
      logger.debug("Snapshots already exist, skipping solution seed");
      return;
    }

    // If convenience collections already have user data, prefer that
    // over static seed files to avoid overwriting real state.
    const hasExistingVehicles = await this.hasVehicles();
    const hasExistingOrders = await this.hasOrders();

    let snapshotVehicles = vehicles;
    let snapshotOrders = orders;
    let snapshotSolution = solution;

    if (hasExistingVehicles || hasExistingOrders) {
      logger.info(
        "Convenience collections contain data -- building initial snapshot from DB (not seed files)",
      );
      snapshotVehicles = hasExistingVehicles ? await this.getVehicles() : vehicles;
      snapshotOrders = hasExistingOrders ? await this.getOrders() : orders;

      // Prune solution assignments to only reference IDs that exist in
      // the actual vehicle/order data, preventing dangling references.
      const vehicleIds = new Set(snapshotVehicles.map((v) => v.id));
      const orderIds = new Set(snapshotOrders.map((o) => o.id));

      snapshotSolution = {
        ...solution,
        assignments: solution.assignments
          .filter((a) => vehicleIds.has(a.vehicle_id))
          .map((a) => ({
            ...a,
            route: a.route.filter((orderId) => orderIds.has(orderId)),
          })),
      };

      const pruned = solution.assignments.length - snapshotSolution.assignments.length;
      const prunedRouteEntries = solution.assignments.reduce((sum, a) => sum + a.route.length, 0)
        - snapshotSolution.assignments.reduce((sum, a) => sum + a.route.length, 0);
      if (pruned > 0 || prunedRouteEntries > 0) {
        logger.warn(
          { prunedAssignments: pruned, prunedRouteEntries },
          "Pruned dangling vehicle/order references from seed solution",
        );
      }
    }

    await this.snapshots.insertOne({
      vehicles: snapshotVehicles,
      orders: snapshotOrders,
      solution: snapshotSolution,
      savedAt: new Date(),
      rev: 1,
    });
    logger.info("Seeded initial full-state snapshot");
  }

  /* ========================= Reading ================================ */

  async getVehicles(): Promise<Vehicle[]> {
    const docs = await this.vehicles
      .find({}, { projection: { _id: 0 } })
      .toArray();

    return docs.map((doc) => VehicleSchema.parse(doc));
  }

  async getOrders(): Promise<Order[]> {
    const docs = await this.orders
      .find({}, { projection: { _id: 0 } })
      .toArray();

    return docs.map((doc) => OrderSchema.parse(doc));
  }

  async getLatestSolution(): Promise<Solution | null> {
    const doc = await this.snapshots.findOne(
      {},
      { sort: { savedAt: -1, rev: -1 }, projection: { _id: 0, solution: 1 } },
    );

    if (!doc?.solution) return null;
    return SolutionSchema.parse(doc.solution);
  }

  async getLatestSnapshotRev(): Promise<number> {
    const doc = await this.snapshots.findOne(
      {},
      { sort: { savedAt: -1, rev: -1 }, projection: { _id: 0, rev: 1 } },
    );
    return (doc?.rev as number) ?? 0;
  }

  async getLatestSnapshot(): Promise<import("../../domain/ports/durable-store.port.ts").Snapshot | null> {
    // Keep _id for unique patch targeting during legacy migration
    const doc = await this.snapshots.findOne(
      {},
      { sort: { savedAt: -1, rev: -1 } },
    );

    if (!doc?.solution) return null;

    const isLegacy = !Array.isArray(doc.vehicles) || !Array.isArray(doc.orders);

    if (isLegacy) {
      logger.warn(
        { rev: doc.rev },
        "Legacy snapshot detected (missing vehicles/orders) -- attempting migration",
      );

      // Pull current data from convenience collections
      const [migratedVehicles, migratedOrders] = await Promise.all([
        this.getVehicles(),
        this.getOrders(),
      ]);

      if (migratedVehicles.length === 0 && migratedOrders.length === 0) {
        throw new Error(
          `Corrupt snapshot (rev=${doc.rev}): missing vehicles/orders fields ` +
          "and convenience collections are also empty -- cannot recover",
        );
      }

      if (migratedVehicles.length === 0 || migratedOrders.length === 0) {
        logger.warn(
          { rev: doc.rev, vehicles: migratedVehicles.length, orders: migratedOrders.length },
          "Legacy migration: one collection is empty (may be valid admin state)",
        );
      }

      // Reconcile solution: prune assignments referencing vehicle/order IDs
      // that don't exist in the migrated master data.
      const parsedSolution = SolutionSchema.parse(doc.solution);
      const vehicleIds = new Set(migratedVehicles.map((v) => v.id));
      const orderIds = new Set(migratedOrders.map((o) => o.id));

      const reconciledSolution = {
        ...parsedSolution,
        assignments: parsedSolution.assignments
          .filter((a) => vehicleIds.has(a.vehicle_id))
          .map((a) => ({
            ...a,
            route: a.route.filter((orderId) => orderIds.has(orderId)),
          })),
      };

      const prunedAssignments =
        parsedSolution.assignments.length - reconciledSolution.assignments.length;
      const prunedRouteEntries = parsedSolution.assignments.reduce((sum, a) => sum + a.route.length, 0)
        - reconciledSolution.assignments.reduce((sum, a) => sum + a.route.length, 0);
      if (prunedAssignments > 0 || prunedRouteEntries > 0) {
        logger.warn(
          { rev: doc.rev, prunedAssignments, prunedRouteEntries },
          "Pruned dangling assignment references during legacy migration",
        );
      }

      // Patch by _id (unique) -- not { rev, savedAt } which may not be unique
      await this.snapshots.updateOne(
        { _id: doc._id },
        { $set: {
          vehicles: migratedVehicles,
          orders: migratedOrders,
          solution: reconciledSolution,
        } },
      );

      logger.info(
        { rev: doc.rev, vehicles: migratedVehicles.length, orders: migratedOrders.length },
        "Migrated legacy snapshot to full-state format",
      );

      return {
        vehicles: migratedVehicles,
        orders: migratedOrders,
        solution: reconciledSolution,
        rev: (doc.rev as number) ?? 0,
        savedAt: doc.savedAt as Date,
      };
    }

    return {
      vehicles: (doc.vehicles as unknown[]).map((v) => VehicleSchema.parse(v)),
      orders: (doc.orders as unknown[]).map((o) => OrderSchema.parse(o)),
      solution: SolutionSchema.parse(doc.solution),
      rev: (doc.rev as number) ?? 0,
      savedAt: doc.savedAt as Date,
    };
  }

  /* ========================= Saving ================================= */

  async saveSnapshot(snapshot: Snapshot): Promise<void> {
    // Step 1: Insert the FULL snapshot as a single document (atomic).
    // This is the source of truth for hydration -- it includes vehicles,
    // orders, solution, and rev in one write. If the process crashes
    // after this point, the durable state is fully consistent.
    await this.snapshots.insertOne({
      vehicles: snapshot.vehicles,
      orders: snapshot.orders,
      solution: snapshot.solution,
      savedAt: snapshot.savedAt,
      rev: snapshot.rev,
    });

    // Step 2: Best-effort sync of convenience master-data collections.
    // These are used by getVehicles/getOrders for read convenience but
    // are NOT the source of truth -- the snapshot document is. If this
    // fails (e.g., process crash), hydration still works from the snapshot.
    try {
      await Promise.all([
        this.syncCollection(this.vehicles, snapshot.vehicles),
        this.syncCollection(this.orders, snapshot.orders),
      ]);
    } catch (err) {
      logger.warn(
        { err, rev: snapshot.rev },
        "Best-effort master-data sync failed (snapshot is safe)",
      );
    }

    logger.info({ rev: snapshot.rev }, "Snapshot saved to MongoDB");
  }

  /* ========================= Diagnostics ============================ */

  async ping(): Promise<boolean> {
    const result = await this.db.command({ ping: 1 });
    return result.ok === 1;
  }

  /* ========================= DRY helpers ============================ */

  /**
   * Idempotent bulk upsert -- safe to call multiple times with the same data.
   * Used for both seeding and save operations.
   */
  private async bulkUpsert(
    collection: Collection,
    items: { id: string }[],
  ): Promise<void> {
    if (items.length === 0) return;

    const ops = items.map((item) => ({
      updateOne: {
        filter: { id: item.id },
        update: { $set: item },
        upsert: true,
      },
    }));

    await collection.bulkWrite(ops);
  }

  /**
   * Upsert current items + remove stale docs no longer in the set.
   * Used during save to keep master-data collections consistent.
   */
  private async syncCollection(
    collection: Collection,
    items: { id: string }[],
  ): Promise<void> {
    const currentIds = items.map((i) => i.id);

    await Promise.all([
      this.bulkUpsert(collection, items),
      collection.deleteMany({ id: { $nin: currentIds } }),
    ]);
  }
}
