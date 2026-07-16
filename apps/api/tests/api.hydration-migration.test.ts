/**
 * Hydration and migration integration tests.
 *
 * Covers Redis cold-start hydration, legacy snapshot migrations,
 * deterministic snapshot selection, and empty-only seed semantics.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  createTestContext,
  createHttpClient,
  type TestContext,
  type HttpClient,
} from "./setup.ts";

let ctx: TestContext;
let http: HttpClient;

beforeAll(async () => {
  ctx = await createTestContext();
  http = createHttpClient(ctx.baseUrl);
}, 30_000);

afterAll(async () => {
  await ctx?.cleanup();
}, 10_000);

/* ------------------------------------------------------------------ */
/*  Hydration: Rev Persistence                                         */
/* ------------------------------------------------------------------ */

describe("Hydration: Rev Persistence", () => {
  it("save → flush Redis → re-hydrate → rev is restored from snapshot", async () => {
    // Step 1: Get current rev
    const { body: preState } = await http.get<{ rev: number }>("/api/state");
    const revBeforeSave = preState.rev;
    expect(revBeforeSave).toBeGreaterThan(0);

    // Step 2: Save plan (persists current rev to MongoDB snapshot)
    const { status: saveStatus, body: saveBody } = await http.post<{
      success: boolean;
      savedRev: number;
    }>("/api/save");
    expect(saveStatus).toBe(200);
    expect(saveBody.savedRev).toBe(revBeforeSave);

    // Step 3: Flush Redis (simulate cold restart)
    const keys = await ctx.redis.keys("ws:default:*");
    if (keys.length) await ctx.redis.del(...keys);

    // Verify Redis is cold
    const coldRev = await ctx.redis.get("ws:default:rev");
    expect(coldRev).toBeNull();

    // Step 4: Re-hydrate (mimics server restart)
    const { runHydration } = await import(
      "../src/application/services/hydration.service.ts"
    );
    const seedData = {
      vehicles: [], // Seed data doesn't matter -- MongoDB already has data
      orders: [],
      solution: { assignments: [] },
    };
    await runHydration(
      {
        draftStore: ctx.container.draftStore,
        durableStore: ctx.container.durableStore,
        redis: ctx.redis,
      },
      seedData,
    );

    // Step 5: Verify rev was restored from snapshot (not hardcoded to 1)
    const { body: postState } = await http.get<{ rev: number }>("/api/state");
    expect(postState.rev).toBe(revBeforeSave);
  });

  it("re-hydrated state contains the same vehicles and orders", async () => {
    const { body } = await http.get<{
      vehicles: { id: string }[];
      orders: { id: string }[];
    }>("/api/state");

    // Baseline seed has 2 vehicles.
    expect(body.vehicles).toHaveLength(2);
    expect(body.vehicles.find((v) => v.id === "v_001")).toBeTruthy();
    expect(body.vehicles.find((v) => v.id === "v_002")).toBeTruthy();

    // Baseline seed has 8 orders.
    expect(body.orders).toHaveLength(8);
  });
});

/* ------------------------------------------------------------------ */
/*  Seeding: Empty-Only Semantics                                      */
/* ------------------------------------------------------------------ */

describe("Seeding: Empty-Only Semantics", () => {
  it("re-seeding does not overwrite existing data after mutations", async () => {
    const mutatedName = "Hydration Seed Guard";

    // Mutate an entity from seed data.
    const { status: updateStatus } = await http.put("/api/vehicles/v_001", {
      name: mutatedName,
      capacity_kg: 500,
      start_location: { lat: 40.7128, lng: -74.0060 },
    });
    expect(updateStatus).toBe(200);

    // Persist mutation and force cold-start hydration.
    const { status: saveStatus } = await http.post("/api/save");
    expect(saveStatus).toBe(200);

    const keys = await ctx.redis.keys("ws:default:*");
    if (keys.length) await ctx.redis.del(...keys);

    const { runHydration } = await import(
      "../src/application/services/hydration.service.ts"
    );
    await runHydration(
      {
        draftStore: ctx.container.draftStore,
        durableStore: ctx.container.durableStore,
        redis: ctx.redis,
      },
      { vehicles: [], orders: [], solution: { assignments: [] } },
    );

    const { body } = await http.get<{
      vehicles: { id: string; name: string }[];
    }>("/api/state");
    const v001 = body.vehicles.find((v) => v.id === "v_001");
    expect(v001).toBeTruthy();
    expect(v001!.name).toBe(mutatedName);
  });
});

/* ------------------------------------------------------------------ */
/*  Hydration: Stale Route Cleanup                                     */
/* ------------------------------------------------------------------ */

describe("Hydration: Stale Route Cleanup", () => {
  it("no stale route:* keys remain after hydration", async () => {
    // After hydration, only route keys for active vehicles should exist
    const routeKeys = await ctx.redis.keys("ws:default:route:*");
    const { body } = await http.get<{
      vehicles: { id: string }[];
    }>("/api/state");

    const activeVehicleIds = new Set(body.vehicles.map((v) => v.id));

    // Every route key must correspond to an active vehicle
    for (const key of routeKeys) {
      const vehicleId = key.replace("ws:default:route:", "");
      expect(activeVehicleIds.has(vehicleId)).toBe(true);
    }

  });
});

/* ------------------------------------------------------------------ */
/*  Hydration: Legacy Snapshot Migration                                */
/* ------------------------------------------------------------------ */

describe("Hydration: Legacy Snapshot Migration", () => {
  it("auto-migrates a legacy snapshot missing vehicles/orders fields", async () => {
    // Step 1: Record current state (vehicles/orders in convenience collections)
    const { body: preState } = await http.get<{
      vehicles: { id: string }[];
      orders: { id: string }[];
      rev: number;
    }>("/api/state");
    const expectedVehicleCount = preState.vehicles.length;
    const expectedOrderCount = preState.orders.length;

    // Step 2: Drop all snapshots and insert a LEGACY snapshot (no vehicles/orders)
    const mongoClient = (await import("mongodb")).MongoClient;
    const client = new mongoClient(
      (await import("../src/config/env.ts")).env.MONGO_URI,
    );
    await client.connect();
    const db = client.db(
      (await import("../src/config/env.ts")).env.MONGO_DATABASE,
    );
    const snapshots = db.collection("snapshots");

    // Get the latest solution for the legacy doc
    const latestSnapshot = await snapshots.findOne(
      {},
      { sort: { savedAt: -1, rev: -1 } },
    );
    expect(latestSnapshot).toBeTruthy();

    await snapshots.deleteMany({});
    await snapshots.insertOne({
      solution: latestSnapshot!.solution,
      savedAt: new Date(),
      rev: 99,
      // Intentionally NO vehicles/orders fields — this is the legacy format
    });

    // Step 3: Flush Redis → force hydration
    const keys = await ctx.redis.keys("ws:default:*");
    if (keys.length) await ctx.redis.del(...keys);

    const { runHydration } = await import(
      "../src/application/services/hydration.service.ts"
    );
    await runHydration(
      {
        draftStore: ctx.container.draftStore,
        durableStore: ctx.container.durableStore,
        redis: ctx.redis,
      },
      { vehicles: [], orders: [], solution: { assignments: [] } },
    );

    // Step 4: Verify state was recovered correctly from convenience collections
    const { body: postState } = await http.get<{
      vehicles: { id: string }[];
      orders: { id: string }[];
      rev: number;
    }>("/api/state");

    expect(postState.vehicles).toHaveLength(expectedVehicleCount);
    expect(postState.orders).toHaveLength(expectedOrderCount);
    expect(postState.rev).toBe(99); // rev from the legacy snapshot

    // Step 5: Verify the snapshot doc was patched in MongoDB
    const patchedDoc = await snapshots.findOne({ rev: 99 });
    expect(Array.isArray(patchedDoc!.vehicles)).toBe(true);
    expect(Array.isArray(patchedDoc!.orders)).toBe(true);
    expect((patchedDoc!.vehicles as unknown[]).length).toBe(expectedVehicleCount);
    expect((patchedDoc!.orders as unknown[]).length).toBe(expectedOrderCount);

    await client.close();
  });
});

/* ------------------------------------------------------------------ */
/*  Hydration: Deterministic Tie-Break                                  */
/* ------------------------------------------------------------------ */

describe("Hydration: Deterministic Tie-Break", () => {
  it("same-millisecond snapshots: highest rev wins", async () => {
    // Step 1: Connect to MongoDB directly
    const mongoClient = (await import("mongodb")).MongoClient;
    const client = new mongoClient(
      (await import("../src/config/env.ts")).env.MONGO_URI,
    );
    await client.connect();
    const db = client.db(
      (await import("../src/config/env.ts")).env.MONGO_DATABASE,
    );
    const snapshots = db.collection("snapshots");

    // Get current state for building valid snapshot docs
    const { body: currentState } = await http.get<{
      vehicles: { id: string }[];
      orders: { id: string }[];
    }>("/api/state");

    // Step 2: Clear snapshots and insert two with IDENTICAL timestamps
    await snapshots.deleteMany({});
    const sharedTimestamp = new Date();

    // Get a valid solution structure
    const latestSolution = await ctx.container.durableStore.getLatestSolution();

    await snapshots.insertMany([
      {
        vehicles: currentState.vehicles,
        orders: currentState.orders,
        solution: latestSolution ?? { assignments: [] },
        savedAt: sharedTimestamp,
        rev: 50, // lower rev
      },
      {
        vehicles: currentState.vehicles,
        orders: currentState.orders,
        solution: latestSolution ?? { assignments: [] },
        savedAt: sharedTimestamp,
        rev: 100, // higher rev — should win
      },
    ]);

    // Step 3: Flush Redis → force hydration
    const keys = await ctx.redis.keys("ws:default:*");
    if (keys.length) await ctx.redis.del(...keys);

    const { runHydration } = await import(
      "../src/application/services/hydration.service.ts"
    );
    await runHydration(
      {
        draftStore: ctx.container.draftStore,
        durableStore: ctx.container.durableStore,
        redis: ctx.redis,
      },
      { vehicles: [], orders: [], solution: { assignments: [] } },
    );

    // Step 4: Verify the higher rev was selected
    const { body: postState } = await http.get<{ rev: number }>("/api/state");
    expect(postState.rev).toBe(100);

    await client.close();
  });
});

/* ------------------------------------------------------------------ */
/*  Legacy Migration: Dangling Solution References                      */
/* ------------------------------------------------------------------ */

describe("Legacy Migration: Dangling Solution Refs", () => {
  it("prunes assignments referencing non-existent vehicles/orders", async () => {
    const mongoClient = (await import("mongodb")).MongoClient;
    const client = new mongoClient(
      (await import("../src/config/env.ts")).env.MONGO_URI,
    );
    await client.connect();
    const db = client.db(
      (await import("../src/config/env.ts")).env.MONGO_DATABASE,
    );
    const snapshots = db.collection("snapshots");

    // Record how many vehicles exist in convenience collections
    const { body: preState } = await http.get<{
      vehicles: { id: string }[];
      orders: { id: string }[];
    }>("/api/state");

    // Drop snapshots and insert a legacy one with dangling refs
    await snapshots.deleteMany({});
    await snapshots.insertOne({
      solution: {
        assignments: [
          { vehicle_id: preState.vehicles[0]!.id, route: [preState.orders[0]!.id] }, // valid
          { vehicle_id: "v_ghost_999", route: ["o_ghost_999"] }, // dangling
        ],
      },
      savedAt: new Date(),
      rev: 200,
      // No vehicles/orders → legacy format
    });

    // Flush Redis → force hydration through legacy migration
    const keys = await ctx.redis.keys("ws:default:*");
    if (keys.length) await ctx.redis.del(...keys);

    const { runHydration } = await import(
      "../src/application/services/hydration.service.ts"
    );
    await runHydration(
      {
        draftStore: ctx.container.draftStore,
        durableStore: ctx.container.durableStore,
        redis: ctx.redis,
      },
      { vehicles: [], orders: [], solution: { assignments: [] } },
    );

    // Verify: hydration succeeded and dangling assignment was pruned
    const { body: postState } = await http.get<{
      rev: number;
      solution: { assignments: { vehicle_id: string; route: string[] }[] };
    }>("/api/state");

    expect(postState.rev).toBe(200);

    // Only the valid assignment should survive
    const assignmentVehicleIds = postState.solution.assignments.map(
      (a) => a.vehicle_id,
    );
    expect(assignmentVehicleIds).not.toContain("v_ghost_999");

    // Verify the patched snapshot in MongoDB also has reconciled solution
    const patchedDoc = await snapshots.findOne({ rev: 200 });
    const patchedAssignments = (patchedDoc!.solution as { assignments: { vehicle_id: string }[] })
      .assignments;
    expect(patchedAssignments.every(
      (a) => a.vehicle_id !== "v_ghost_999",
    )).toBe(true);

    await client.close();
  });
});

/* ------------------------------------------------------------------ */
/*  Legacy Migration: One Empty Collection (Valid Admin State)           */
/* ------------------------------------------------------------------ */

describe("Legacy Migration: One Empty Collection", () => {
  it("succeeds when orders collection is legitimately empty", async () => {
    const mongoClient = (await import("mongodb")).MongoClient;
    const client = new mongoClient(
      (await import("../src/config/env.ts")).env.MONGO_URI,
    );
    await client.connect();
    const db = client.db(
      (await import("../src/config/env.ts")).env.MONGO_DATABASE,
    );
    const snapshots = db.collection("snapshots");
    const ordersCol = db.collection("orders");

    // Record vehicle count for verification
    const { body: preState } = await http.get<{
      vehicles: { id: string }[];
    }>("/api/state");
    const expectedVehicleCount = preState.vehicles.length;

    // Clear orders collection (simulate admin wipe) + drop snapshots + insert legacy
    await ordersCol.deleteMany({});
    await snapshots.deleteMany({});
    await snapshots.insertOne({
      solution: { assignments: [] },
      savedAt: new Date(),
      rev: 300,
    });

    // Flush Redis → force hydration
    const keys = await ctx.redis.keys("ws:default:*");
    if (keys.length) await ctx.redis.del(...keys);

    const { runHydration } = await import(
      "../src/application/services/hydration.service.ts"
    );
    await runHydration(
      {
        draftStore: ctx.container.draftStore,
        durableStore: ctx.container.durableStore,
        redis: ctx.redis,
      },
      { vehicles: [], orders: [], solution: { assignments: [] } },
    );

    // Verify: hydration succeeded without throwing
    const { body: postState } = await http.get<{
      vehicles: { id: string }[];
      orders: { id: string }[];
      rev: number;
    }>("/api/state");

    expect(postState.rev).toBe(300);
    expect(postState.vehicles).toHaveLength(expectedVehicleCount); // vehicles recovered
    expect(postState.orders).toHaveLength(0); // legitimately empty

    await client.close();
  });
});
