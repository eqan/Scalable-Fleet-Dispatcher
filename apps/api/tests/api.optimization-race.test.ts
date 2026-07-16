/**
 * Optimization race-condition integration tests.
 *
 * Covers stale optimization handling and stream-level consumer behavior.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  createTestContext,
  createHttpClient,
  type TestContext,
  type HttpClient,
} from "./setup.ts";
import { createResultsHandler } from "../src/application/services/results-handler.ts";
import { REDIS_KEYS, STREAM_KEYS } from "../src/config/redis-keys.ts";

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
/*  Optimization Race Conditions                                       */
/* ------------------------------------------------------------------ */


describe("Optimization Race: Order Reassigned Mid-Flight", () => {
  it("stale optimization result does not overwrite dispatcher reassignment", async () => {
    // Create two vehicles and an order for this test (fully self-contained)
    await http.post("/api/vehicles", {
      id: "v_race_src",
      name: "Race Source",
      capacity_kg: 999,
      start_location: { lat: 52, lng: 13 },
    });
    await http.post("/api/vehicles", {
      id: "v_race_tgt",
      name: "Race Target",
      capacity_kg: 999,
      start_location: { lat: 52, lng: 13 },
    });
    await http.post("/api/orders", {
      id: "o_race_001",
      weight_kg: 10,
      location: { lat: 52.5, lng: 13.4 },
      service_time_min: 5,
    });

    // Assign order to source vehicle
    await http.post("/api/assign", {
      orderId: "o_race_001",
      vehicleId: "v_race_src",
    });

    // Capture the "stale" route as if optimization started here
    const staleRoute = ["o_race_001"];

    // Dispatcher reassigns the order to another vehicle
    const { status: assignStatus } = await http.post("/api/assign", {
      orderId: "o_race_001",
      vehicleId: "v_race_tgt",
    });
    expect(assignStatus).toBe(200);

    // Late optimization result arrives with the STALE route
    const { rev: updateRev } = await ctx.container.draftStore.updateRoute(
      "v_race_src",
      staleRoute,
      -1, // skip OCC — testing reconciliation logic, not rev guard
    );
    expect(typeof updateRev).toBe("number");

    // Verify the moved order did NOT reappear on the source vehicle
    const { body: finalState } = await http.get<{
      solution: { assignments: { vehicle_id: string; route: string[] }[] };
    }>("/api/state");

    const sourceRoute = finalState.solution.assignments.find(
      (a) => a.vehicle_id === "v_race_src",
    )?.route ?? [];
    const targetRoute = finalState.solution.assignments.find(
      (a) => a.vehicle_id === "v_race_tgt",
    )?.route ?? [];

    // The moved order should NOT be on the source vehicle
    expect(sourceRoute).not.toContain("o_race_001");
    // The moved order should still be on the target vehicle
    expect(targetRoute).toContain("o_race_001");
  });
});

describe("Optimization Race: New Arrival Preserved", () => {
  it("dispatcher-added order survives stale optimization result", async () => {
    // Setup: create vehicle and two orders
    await http.post("/api/vehicles", {
      id: "v_arrival",
      name: "Arrival Test",
      capacity_kg: 999,
      start_location: { lat: 52, lng: 13 },
    });
    await http.post("/api/orders", {
      id: "o_orig",
      weight_kg: 10,
      location: { lat: 52.5, lng: 13.4 },
      service_time_min: 5,
    });
    await http.post("/api/orders", {
      id: "o_new_arrival",
      weight_kg: 10,
      location: { lat: 52.6, lng: 13.5 },
      service_time_min: 5,
    });

    // Assign first order to vehicle
    await http.post("/api/assign", {
      orderId: "o_orig",
      vehicleId: "v_arrival",
    });

    // "Optimization starts" — captures route [o_orig]
    const staleRoute = ["o_orig"];

    // Dispatcher adds a NEW order to the same vehicle
    const { status: assignStatus } = await http.post("/api/assign", {
      orderId: "o_new_arrival",
      vehicleId: "v_arrival",
    });
    expect(assignStatus).toBe(200);

    // Late optimization result arrives with stale route (doesn't know about o_new_arrival)
    const { rev: updateRev } = await ctx.container.draftStore.updateRoute(
      "v_arrival",
      staleRoute,
      -1, // skip OCC — testing new-arrival preservation, not rev guard
    );
    expect(typeof updateRev).toBe("number");

    // Verify: o_new_arrival was NOT evicted — it should still be on the route
    const { body: finalState } = await http.get<{
      solution: { assignments: { vehicle_id: string; route: string[] }[] };
    }>("/api/state");

    const route = finalState.solution.assignments.find(
      (a) => a.vehicle_id === "v_arrival",
    )?.route ?? [];

    expect(route).toContain("o_orig");       // optimization result order preserved
    expect(route).toContain("o_new_arrival"); // dispatcher new arrival preserved
  });
});

describe("Optimization Race: Vehicle Deleted — Handler Level", () => {
  it("handler swallows NOT_FOUND and does not throw", async () => {
    // Create a temporary vehicle and order
    await http.post("/api/vehicles", {
      id: "v_handler_del",
      name: "Handler Delete Test",
      capacity_kg: 500,
      start_location: { lat: 52.52, lng: 13.405 },
    });
    await http.post("/api/orders", {
      id: "o_handler_del",
      weight_kg: 10,
      location: { lat: 52.5, lng: 13.4 },
      service_time_min: 5,
    });
    await http.post("/api/assign", {
      orderId: "o_handler_del",
      vehicleId: "v_handler_del",
    });

    // Capture baseRev as if optimization started now
    const baseRev = (await ctx.container.draftStore.getRev()) ?? 0;

    // Vehicle is deleted
    const { status: deleteStatus } = await http.del(
      `/api/vehicles/v_handler_del`,
    );
    expect(deleteStatus).toBe(200);

    // Build a handler and feed it a stale result message
    const handler = createResultsHandler({
      draftStore: ctx.container.draftStore,
      gateway: ctx.container.realtimeGateway,
    });

    // Handler should NOT throw — it catches NOT_FOUND and returns gracefully
    await expect(
      handler({
        id: "test-stale-msg-001",
        data: {
          type: "route_optimized",
          vehicleId: "v_handler_del",
          route: JSON.stringify(["o_handler_del"]),
          requestId: "req-stale-001",
          baseRev: String(baseRev),
          timestamp: String(Date.now()),
        },
      }),
    ).resolves.toBeUndefined();

    // Verify order is not stuck on any route
    const { body: finalState } = await http.get<{
      solution: { assignments: { vehicle_id: string; route: string[] }[] };
    }>("/api/state");

    for (const assignment of finalState.solution.assignments) {
      expect(assignment.route).not.toContain("o_handler_del");
    }
  });
});

describe("Optimization Race: Stream-Level Stale Result", () => {
  it("stale result published to results:stream is consumed, acked, and does not change state", async () => {
    // Create vehicle + order for this test
    await http.post("/api/vehicles", {
      id: "v_stream_test",
      name: "Stream Test",
      capacity_kg: 999,
      start_location: { lat: 52, lng: 13 },
    });
    await http.post("/api/orders", {
      id: "o_stream_test",
      weight_kg: 10,
      location: { lat: 52.5, lng: 13.4 },
      service_time_min: 5,
    });
    await http.post("/api/assign", {
      orderId: "o_stream_test",
      vehicleId: "v_stream_test",
    });

    // Snapshot state BEFORE publishing the stale result
    const { body: stateBefore } = await http.get<{
      solution: { assignments: { vehicle_id: string; route: string[] }[] };
      rev: number;
    }>("/api/state");

    const routeBefore = stateBefore.solution.assignments.find(
      (a) => a.vehicle_id === "v_stream_test",
    )?.route ?? [];

    // Use a very old baseRev so OCC rejects it
    const staleBaseRev = 1;

    // Publish a stale result directly to results:stream
    await ctx.redis.xadd(
      STREAM_KEYS.results,
      "*",
      "type",
      "route_optimized",
      "vehicleId",
      "v_stream_test",
      "route",
      JSON.stringify(["o_stream_test"]),
      "requestId",
      "req-stream-stale-001",
      "baseRev",
      String(staleBaseRev),
      "timestamp",
      String(Date.now()),
    );

    // Poll XPENDING until the consumer ACKs the message (timeout 5s)
    const deadline = Date.now() + 5_000;
    let pendingCount = -1;
    while (Date.now() < deadline) {
      const pending = (await ctx.redis.call(
        "XPENDING",
        STREAM_KEYS.results,
        STREAM_KEYS.groups.apiUpdaters,
      )) as [number, string | null, string | null, [string, string][] | null];
      pendingCount = pending[0] as number;
      if (pendingCount === 0) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(pendingCount).toBe(0);

    // Assert state is unchanged — stale result should have been discarded
    const { body: stateAfter } = await http.get<{
      solution: { assignments: { vehicle_id: string; route: string[] }[] };
    }>("/api/state");

    const routeAfter = stateAfter.solution.assignments.find(
      (a) => a.vehicle_id === "v_stream_test",
    )?.route ?? [];

    expect(routeAfter).toEqual(routeBefore);
  });
});

describe("Optimization Capacity Guard: Route Apply Atomicity", () => {
  it("capacity rejection on updateRoute does not mutate route", async () => {
    await http.post("/api/vehicles", {
      id: "v_route_atomic",
      name: "Route Atomicity",
      capacity_kg: 50,
      start_location: { lat: 52, lng: 13 },
    });
    await http.post("/api/orders", {
      id: "o_atomic_1",
      weight_kg: 40,
      location: { lat: 52.5, lng: 13.4 },
      service_time_min: 5,
    });
    await http.post("/api/orders", {
      id: "o_atomic_2",
      weight_kg: 30,
      location: { lat: 52.6, lng: 13.5 },
      service_time_min: 5,
    });

    // Set ownership directly via Redis to avoid race with the background
    // resultsConsumer, which may process stale stream messages and flip
    // orders back to UNASSIGNED between an HTTP /api/assign and our
    // updateRoute() call.
    await ctx.redis.hset(REDIS_KEYS.orderToVehicle, "o_atomic_1", "v_route_atomic");
    await ctx.redis.srem(REDIS_KEYS.unassigned, "o_atomic_1");
    await ctx.redis.rpush(REDIS_KEYS.route("v_route_atomic"), "o_atomic_1");

    await ctx.redis.hset(REDIS_KEYS.orderToVehicle, "o_atomic_2", "v_route_atomic");
    await ctx.redis.srem(REDIS_KEYS.unassigned, "o_atomic_2");

    const routeBefore = await ctx.redis.lrange(
      REDIS_KEYS.route("v_route_atomic"),
      0,
      -1,
    );

    await expect(
      ctx.container.draftStore.updateRoute(
        "v_route_atomic",
        ["o_atomic_1", "o_atomic_2"], // load would become 70 > 50
        -1,
      ),
    ).rejects.toHaveProperty("code", "CAPACITY_EXCEEDED");

    const routeAfter = await ctx.redis.lrange(
      REDIS_KEYS.route("v_route_atomic"),
      0,
      -1,
    );

    expect(routeAfter).toEqual(routeBefore);
    expect(routeAfter).toEqual(["o_atomic_1"]);

    await http.del("/api/orders/o_atomic_1");
    await http.del("/api/orders/o_atomic_2");
    await http.del("/api/vehicles/v_route_atomic");
  });
});
