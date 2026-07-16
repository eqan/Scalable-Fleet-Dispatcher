/**
 * Core API integration flow tests.
 *
 * Story-driven sequence covering CRUD, assignment, OCC,
 * save/delete behavior, final consistency, and security headers.
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
/*  Health Check                                                       */
/* ------------------------------------------------------------------ */

describe("GET /api/health", () => {
  it("returns 200 with healthy status when both services are up", async () => {
    const { status, body } = await http.get<{
      status: string;
      timestamp: string;
      uptime_s: number;
      services: {
        redis: { status: string; latency_ms: number };
        mongo: { status: string; latency_ms: number };
      };
    }>("/api/health");

    expect(status).toBe(200);
    expect(body.status).toBe("healthy");
    expect(body.services.redis.status).toBe("connected");
    expect(body.services.mongo.status).toBe("connected");
    expect(typeof body.timestamp).toBe("string");
    expect(typeof body.uptime_s).toBe("number");
    expect(body.services.redis.latency_ms).toBeGreaterThanOrEqual(0);
    expect(body.services.mongo.latency_ms).toBeGreaterThanOrEqual(0);
  });
});

/* ------------------------------------------------------------------ */
/*  State Retrieval                                                    */
/* ------------------------------------------------------------------ */

describe("GET /api/state", () => {
  it("returns 200 with the full hydrated planning state", async () => {
    const { status, body } = await http.get<{
      vehicles: unknown[];
      orders: unknown[];
      solution: { assignments: unknown[] };
      unassignedOrderIds: string[];
      rev: number;
    }>("/api/state");

    expect(status).toBe(200);

    // Seed data: 2 vehicles, 8 orders
    expect(body.vehicles).toHaveLength(2);
    expect(body.orders).toHaveLength(8);

    // Solution: 2 assignments (v_001 → [o_101, o_102, o_104], v_002 → [o_105])
    expect(body.solution.assignments).toHaveLength(2);

    // Rev: at least 1 (set during hydration)
    expect(body.rev).toBeGreaterThan(0);

    // Unassigned: 8 total orders - 4 assigned = 4 unassigned
    expect(body.unassignedOrderIds).toHaveLength(4);
    expect(body.unassignedOrderIds).toContain("o_103");
    expect(body.unassignedOrderIds).toContain("o_106");
    expect(body.unassignedOrderIds).toContain("o_107");
    expect(body.unassignedOrderIds).toContain("o_108");
  });
});

/* ------------------------------------------------------------------ */
/*  Vehicle CRUD                                                       */
/* ------------------------------------------------------------------ */

describe("Vehicle CRUD", () => {
  const testVehicle = {
    id: "v_test_001",
    name: "Test Van",
    capacity_kg: 750,
    start_location: { lat: 41.0, lng: -73.0 },
  };

  describe("POST /api/vehicles", () => {
    it("creates a new vehicle → 201", async () => {
      const { status, body } = await http.post<{
        vehicle: { id: string; name: string; capacity_kg: number };
        rev: number;
      }>("/api/vehicles", testVehicle);

      expect(status).toBe(201);
      expect(body.vehicle.id).toBe("v_test_001");
      expect(body.vehicle.name).toBe("Test Van");
      expect(body.vehicle.capacity_kg).toBe(750);
      expect(typeof body.rev).toBe("number");
    });

    it("rejects duplicate vehicle ID → 409", async () => {
      const { status, body } = await http.post<{ code: string }>("/api/vehicles", testVehicle);

      expect(status).toBe(409);
      expect(body.code).toBe("CONFLICT");
    });

    it("rejects invalid body (missing required fields) → 422", async () => {
      const { status, body } = await http.post<{ code: string; details: unknown }>(
        "/api/vehicles",
        { id: "v_bad" }, // missing name, capacity_kg, start_location
      );

      expect(status).toBe(422);
      expect(body.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("PUT /api/vehicles/:id", () => {
    it("updates an existing vehicle → 200", async () => {
      const { status, body } = await http.put<{
        vehicle: { id: string; name: string; capacity_kg: number };
        rev: number;
      }>("/api/vehicles/v_test_001", {
        name: "Updated Test Van",
        capacity_kg: 800,
        start_location: { lat: 41.0, lng: -73.0 },
      });

      expect(status).toBe(200);
      expect(body.vehicle.name).toBe("Updated Test Van");
      expect(body.vehicle.capacity_kg).toBe(800);
      expect(body.vehicle.id).toBe("v_test_001"); // ID preserved from URL
    });

    it("returns 404 for non-existent vehicle", async () => {
      const { status, body } = await http.put<{ code: string }>("/api/vehicles/v_nonexistent", {
        name: "Ghost",
        capacity_kg: 100,
        start_location: { lat: 0, lng: 0 },
      });

      expect(status).toBe(404);
      expect(body.code).toBe("NOT_FOUND");
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Order CRUD                                                         */
/* ------------------------------------------------------------------ */

describe("Order CRUD", () => {
  const testOrder = {
    id: "o_test_001",
    weight_kg: 25,
    location: { lat: 41.0, lng: -73.0 },
    service_time_min: 10,
  };

  describe("POST /api/orders", () => {
    it("creates a new order → 201", async () => {
      const { status, body } = await http.post<{
        order: { id: string; weight_kg: number };
        rev: number;
      }>("/api/orders", testOrder);

      expect(status).toBe(201);
      expect(body.order.id).toBe("o_test_001");
      expect(body.order.weight_kg).toBe(25);
      expect(typeof body.rev).toBe("number");
    });

    it("rejects duplicate order ID → 409", async () => {
      const { status, body } = await http.post<{ code: string }>("/api/orders", testOrder);

      expect(status).toBe(409);
      expect(body.code).toBe("CONFLICT");
    });
  });

  describe("PUT /api/orders/:id", () => {
    it("updates an existing order → 200", async () => {
      const { status, body } = await http.put<{
        order: { id: string; weight_kg: number; service_time_min: number };
        rev: number;
      }>("/api/orders/o_test_001", {
        weight_kg: 50,
        location: { lat: 41.1, lng: -73.1 },
        service_time_min: 15,
      });

      expect(status).toBe(200);
      expect(body.order.weight_kg).toBe(50);
      expect(body.order.service_time_min).toBe(15);
    });

    it("returns 404 for non-existent order", async () => {
      const { status, body } = await http.put<{ code: string }>("/api/orders/o_nonexistent", {
        weight_kg: 10,
        location: { lat: 0, lng: 0 },
        service_time_min: 5,
      });

      expect(status).toBe(404);
      expect(body.code).toBe("NOT_FOUND");
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Assignment                                                         */
/* ------------------------------------------------------------------ */

describe("Assignment", () => {
  it("POST /api/assign → 200 assigns order to vehicle", async () => {
    const { status, body } = await http.post<{
      success: boolean;
      rev: number;
    }>("/api/assign", {
      orderId: "o_test_001",
      vehicleId: "v_test_001",
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(typeof body.rev).toBe("number");
  });

  it("verifies the order appears in the vehicle's route", async () => {
    const { body } = await http.get<{
      solution: { assignments: { vehicle_id: string; route: string[] }[] };
    }>("/api/state");

    const assignment = body.solution.assignments.find(
      (a) => a.vehicle_id === "v_test_001",
    );
    expect(assignment).toBeTruthy();
    expect(assignment!.route).toContain("o_test_001");
  });

  it("POST /api/assign → 200 unassigns order (vehicleId = UNASSIGNED)", async () => {
    const { status, body } = await http.post<{
      success: boolean;
      rev: number;
    }>("/api/assign", {
      orderId: "o_test_001",
      vehicleId: "UNASSIGNED",
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("POST /api/assign → 200 re-assigns order", async () => {
    // Re-assign to v_001 (seed vehicle)
    const { status, body } = await http.post<{
      success: boolean;
      rev: number;
    }>("/api/assign", {
      orderId: "o_test_001",
      vehicleId: "v_001",
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("POST /api/assign → 404 for non-existent order", async () => {
    const { status, body } = await http.post<{ code: string }>("/api/assign", {
      orderId: "o_nonexistent",
      vehicleId: "v_001",
    });

    expect(status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("POST /api/assign → 422 for invalid body", async () => {
    const { status, body } = await http.post<{ code: string }>("/api/assign", {
      invalidField: "x",
    });

    expect(status).toBe(422);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  /* ---- Capacity enforcement ---- */

  it("POST /api/assign → 422 when assignment would exceed vehicle capacity", async () => {
    // Setup: create a vehicle with small capacity and two heavy orders
    await http.post("/api/vehicles", {
      id: "v_cap_test",
      name: "Small Van",
      capacity_kg: 100,
      start_location: { lat: 41.0, lng: -73.0 },
    });
    await http.post("/api/orders", {
      id: "o_cap_1",
      weight_kg: 60,
      location: { lat: 41.0, lng: -73.0 },
      service_time_min: 5,
    });
    await http.post("/api/orders", {
      id: "o_cap_2",
      weight_kg: 60,
      location: { lat: 41.1, lng: -73.1 },
      service_time_min: 5,
    });

    // First order fits (60 <= 100)
    const { status: s1 } = await http.post<{ success: boolean }>("/api/assign", {
      orderId: "o_cap_1",
      vehicleId: "v_cap_test",
    });
    expect(s1).toBe(200);

    // Second order would exceed capacity (60 + 60 = 120 > 100)
    const { status: s2, body: b2 } = await http.post<{ code: string }>("/api/assign", {
      orderId: "o_cap_2",
      vehicleId: "v_cap_test",
    });
    expect(s2).toBe(422);
    expect(b2.code).toBe("CAPACITY_EXCEEDED");

    // Cleanup
    await http.del("/api/orders/o_cap_1");
    await http.del("/api/orders/o_cap_2");
    await http.del("/api/vehicles/v_cap_test");
  });

  it("POST /api/assign → 200 allows unassign even from overloaded vehicle", async () => {
    // Setup: assign an order to a seed vehicle, then unassign it
    // (unassign must always succeed regardless of capacity state)
    const { status: assignStatus } = await http.post<{ success: boolean }>("/api/assign", {
      orderId: "o_103",
      vehicleId: "v_001",
    });
    expect(assignStatus).toBe(200);

    const { status: unassignStatus, body } = await http.post<{
      success: boolean;
      rev: number;
    }>("/api/assign", {
      orderId: "o_103",
      vehicleId: "UNASSIGNED",
    });
    expect(unassignStatus).toBe(200);
    expect(body.success).toBe(true);
  });

  it("PUT /api/orders/:id → 422 when weight update would exceed vehicle capacity", async () => {
    // Setup: small vehicle + order that fits
    await http.post("/api/vehicles", {
      id: "v_wt_test",
      name: "Tiny Van",
      capacity_kg: 50,
      start_location: { lat: 41.0, lng: -73.0 },
    });
    await http.post("/api/orders", {
      id: "o_wt_1",
      weight_kg: 30,
      location: { lat: 41.0, lng: -73.0 },
      service_time_min: 5,
    });

    // Assign order (30 <= 50 ✓)
    const { status: assignStatus } = await http.post<{ success: boolean }>("/api/assign", {
      orderId: "o_wt_1",
      vehicleId: "v_wt_test",
    });
    expect(assignStatus).toBe(200);

    // Update weight to exceed capacity (60 > 50)
    const { status: updateStatus, body: updateBody } = await http.put<{ code: string }>(
      "/api/orders/o_wt_1",
      {
        weight_kg: 60,
        location: { lat: 41.0, lng: -73.0 },
        service_time_min: 5,
      },
    );
    expect(updateStatus).toBe(422);
    expect(updateBody.code).toBe("CAPACITY_EXCEEDED");

    // Cleanup
    await http.del("/api/orders/o_wt_1");
    await http.del("/api/vehicles/v_wt_test");
  });

  it("PUT /api/vehicles/:id → 422 when capacity downsize would overload existing route", async () => {
    await http.post("/api/vehicles", {
      id: "v_downsize_test",
      name: "Downsize Guard",
      capacity_kg: 100,
      start_location: { lat: 41.0, lng: -73.0 },
    });
    await http.post("/api/orders", {
      id: "o_down_1",
      weight_kg: 40,
      location: { lat: 41.0, lng: -73.0 },
      service_time_min: 5,
    });
    await http.post("/api/orders", {
      id: "o_down_2",
      weight_kg: 40,
      location: { lat: 41.1, lng: -73.1 },
      service_time_min: 5,
    });

    await http.post("/api/assign", {
      orderId: "o_down_1",
      vehicleId: "v_downsize_test",
    });
    await http.post("/api/assign", {
      orderId: "o_down_2",
      vehicleId: "v_downsize_test",
    });

    const { status, body } = await http.put<{ code: string }>(
      "/api/vehicles/v_downsize_test",
      {
        name: "Downsize Guard",
        capacity_kg: 70, // current route load is 80
        start_location: { lat: 41.0, lng: -73.0 },
      },
    );

    expect(status).toBe(422);
    expect(body.code).toBe("CAPACITY_EXCEEDED");

    const { body: state } = await http.get<{
      vehicles: { id: string; capacity_kg: number }[];
    }>("/api/state");
    const vehicle = state.vehicles.find((v) => v.id === "v_downsize_test");
    expect(vehicle?.capacity_kg).toBe(100); // unchanged on failed update

    await http.del("/api/orders/o_down_1");
    await http.del("/api/orders/o_down_2");
    await http.del("/api/vehicles/v_downsize_test");
  });
});

/* ------------------------------------------------------------------ */
/*  Optimization (async 202 pattern)                                   */
/* ------------------------------------------------------------------ */

describe("Optimization", () => {
  it("POST /api/optimize → 202 accepted (async processing)", async () => {
    const { status, body } = await http.post<{
      requestId: string;
      eventId: string;
    }>("/api/optimize", {
      vehicleId: "v_001",
    });

    expect(status).toBe(202);
    expect(typeof body.requestId).toBe("string");
    expect(typeof body.eventId).toBe("string");
    // UUID format check
    expect(body.requestId.length).toBe(36);
  });

  it("POST /api/optimize → 404 for non-existent vehicle", async () => {
    const { status, body } = await http.post<{ code: string }>("/api/optimize", {
      vehicleId: "v_nonexistent",
    });

    expect(status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });
});

/* ------------------------------------------------------------------ */
/*  Save Plan                                                          */
/* ------------------------------------------------------------------ */

describe("Save Plan", () => {
  it("POST /api/save → 200 persists state to MongoDB", async () => {
    const { status, body } = await http.post<{
      success: boolean;
      savedRev: number;
      savedAt: string;
    }>("/api/save");

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(typeof body.savedRev).toBe("number");
    expect(body.savedRev).toBeGreaterThan(0);
    // savedAt should be a valid ISO date string
    expect(new Date(body.savedAt).getTime()).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Optimistic Concurrency Control (OCC)                               */
/* ------------------------------------------------------------------ */

describe("Optimistic Concurrency Control", () => {
  it("rejects mutation with stale baseRev → 409", async () => {
    // Step 1: Get current rev
    const { body: state } = await http.get<{ rev: number }>("/api/state");
    const staleRev = state.rev;

    // Step 2: Make a mutation (this increments rev to staleRev + 1)
    const { status: updateStatus } = await http.put("/api/vehicles/v_001", {
      name: "OCC Update 1",
      capacity_kg: 500,
      start_location: { lat: 40.7128, lng: -74.006 },
    });
    expect(updateStatus).toBe(200);

    // Step 3: Try to mutate with the now-stale rev → CONFLICT
    const { status, body } = await http.put<{ code: string; message: string }>(
      "/api/vehicles/v_001",
      {
        name: "OCC Update 2",
        capacity_kg: 500,
        start_location: { lat: 40.7128, lng: -74.006 },
        baseRev: staleRev, // This is stale
      },
    );

    expect(status).toBe(409);
    expect(body.code).toBe("CONFLICT");
    expect(body.message).toContain("Revision conflict");
  });

  it("accepts mutation with correct baseRev → 200", async () => {
    // Get the CURRENT rev
    const { body: state } = await http.get<{ rev: number }>("/api/state");
    const currentRev = state.rev;

    const { status, body } = await http.put<{ vehicle: unknown; rev: number }>(
      "/api/vehicles/v_001",
      {
        name: "OCC Update Accepted",
        capacity_kg: 500,
        start_location: { lat: 40.7128, lng: -74.006 },
        baseRev: currentRev,
      },
    );

    expect(status).toBe(200);
    expect(body.rev).toBe(currentRev + 1);
  });

  it("accepts mutation without baseRev (OCC opt-in only) → 200", async () => {
    const { status, body } = await http.put<{ vehicle: unknown; rev: number }>(
      "/api/vehicles/v_001",
      {
        name: "No OCC Update",
        capacity_kg: 500,
        start_location: { lat: 40.7128, lng: -74.006 },
        // No baseRev → skip OCC check
      },
    );

    expect(status).toBe(200);
    expect(typeof body.rev).toBe("number");
  });
});

/* ------------------------------------------------------------------ */
/*  Deletion                                                           */
/* ------------------------------------------------------------------ */

describe("Deletion", () => {
  it("DELETE /api/orders/o_test_001 → 200 removes test order", async () => {
    const { status, body } = await http.del<{ rev: number }>("/api/orders/o_test_001");

    expect(status).toBe(200);
    expect(typeof body.rev).toBe("number");
  });

  it("verifies deleted order no longer appears in state", async () => {
    const { body } = await http.get<{ orders: { id: string }[] }>("/api/state");
    const found = body.orders.find((o) => o.id === "o_test_001");
    expect(found).toBeUndefined();
  });

  it("DELETE /api/vehicles/v_test_001 → 200 removes test vehicle", async () => {
    const { status, body } = await http.del<{
      unassignedOrderIds: string[];
      rev: number;
    }>("/api/vehicles/v_test_001");

    expect(status).toBe(200);
    expect(typeof body.rev).toBe("number");
    expect(Array.isArray(body.unassignedOrderIds)).toBe(true);
  });

  it("DELETE /api/vehicles/v_test_001 → 404 already deleted", async () => {
    const { status, body } = await http.del<{ code: string }>("/api/vehicles/v_test_001");

    expect(status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("DELETE /api/orders/o_nonexistent → 404", async () => {
    const { status, body } = await http.del<{ code: string }>("/api/orders/o_nonexistent");

    expect(status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });
});

/* ------------------------------------------------------------------ */
/*  Final State Consistency                                            */
/* ------------------------------------------------------------------ */

describe("Final State Consistency", () => {
  it("state reflects all mutations correctly", async () => {
    const { status, body } = await http.get<{
      vehicles: { id: string; name: string }[];
      orders: { id: string }[];
      solution: { assignments: unknown[] };
      rev: number;
    }>("/api/state");

    expect(status).toBe(200);

    // Seed: 2 vehicles + 1 created − 1 deleted = 2
    expect(body.vehicles).toHaveLength(2);

    // The surviving seed vehicles should be present
    const v001 = body.vehicles.find((v) => v.id === "v_001");
    expect(v001).toBeTruthy();
    expect(v001!.name).toBe("No OCC Update"); // Last update from OCC tests

    const v002 = body.vehicles.find((v) => v.id === "v_002");
    expect(v002).toBeTruthy();

    // Seed: 8 orders + 1 created − 1 deleted = 8
    expect(body.orders).toHaveLength(8);

    // The test order should not exist
    expect(body.orders.find((o) => o.id === "o_test_001")).toBeUndefined();

    // Rev should have been incremented by each mutation
    expect(body.rev).toBeGreaterThan(1);
  });

  it("rev is a positive integer", async () => {
    const { body } = await http.get<{ rev: number }>("/api/state");

    expect(Number.isInteger(body.rev)).toBe(true);
    expect(body.rev).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Security Headers                                                   */
/* ------------------------------------------------------------------ */

describe("Security Headers", () => {
  it("responses include Helmet security headers", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/health`);

    // Helmet sets these headers by default
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  it("CORS headers are present", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/health`, {
      headers: { Origin: "http://localhost:3000" },
    });

    // With CORS_ORIGIN=* (default), Access-Control-Allow-Origin should be *
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
