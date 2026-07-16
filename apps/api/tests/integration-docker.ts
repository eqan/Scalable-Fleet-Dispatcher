/**
 * Docker integration tests — exercises the running containerized API.
 *
 * Unlike the in-process API integration suites, these hit the real Docker
 * container at API_URL.  Every request flows through the full stack
 * (nginx → Express → Redis/Mongo) and generates Prometheus metrics
 * visible in Grafana.
 *
 * Prerequisites:
 *   docker compose up -d   (all services healthy)
 *
 * Run:
 *   API_URL=http://127.0.0.1:4000 bun test tests/integration-docker.test.ts
 */

import { describe, it, expect } from "bun:test";

/* ------------------------------------------------------------------ */
/*  Minimal HTTP client (self-contained — no env validation chain)     */
/* ------------------------------------------------------------------ */

interface HttpResponse<T = unknown> {
  status: number;
  body: T;
}

const createHttpClient = (baseUrl: string) => ({
  get: async <T = unknown>(path: string): Promise<HttpResponse<T>> => {
    const res = await fetch(`${baseUrl}${path}`);
    return { status: res.status, body: (await res.json()) as T };
  },
  post: async <T = unknown>(path: string, data?: unknown): Promise<HttpResponse<T>> => {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: data !== undefined ? JSON.stringify(data) : undefined,
    });
    return { status: res.status, body: (await res.json()) as T };
  },
  put: async <T = unknown>(path: string, data: unknown): Promise<HttpResponse<T>> => {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return { status: res.status, body: (await res.json()) as T };
  },
  del: async <T = unknown>(path: string): Promise<HttpResponse<T>> => {
    const res = await fetch(`${baseUrl}${path}`, { method: "DELETE" });
    let body: T;
    try { body = (await res.json()) as T; } catch { body = {} as T; }
    return { status: res.status, body };
  },
});

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

const API_URL = process.env.API_URL || "http://127.0.0.1:4000";
const http = createHttpClient(API_URL);

/** Helper: fetch current rev from /api/state. */
const getCurrentRev = async (): Promise<number> => {
  const { body } = await http.get<{ rev: number }>("/api/state");
  return body.rev;
};

/* ------------------------------------------------------------------ */
/*  Health                                                             */
/* ------------------------------------------------------------------ */

describe("Docker: GET /api/health", () => {
  it("returns 200 healthy", async () => {
    const { status, body } = await http.get<{ status: string }>("/api/health");
    expect(status).toBe(200);
    expect(body.status).toBe("healthy");
  });
});

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */

describe("Docker: GET /api/state", () => {
  it("returns full planning state with vehicles, orders, solution, rev", async () => {
    const { status, body } = await http.get<{
      vehicles: unknown[];
      orders: unknown[];
      solution: unknown;
      rev: number;
    }>("/api/state");

    expect(status).toBe(200);
    expect(Array.isArray(body.vehicles)).toBe(true);
    expect(Array.isArray(body.orders)).toBe(true);
    expect(body.solution).toBeDefined();
    expect(typeof body.rev).toBe("number");
  });
});

/* ------------------------------------------------------------------ */
/*  Vehicle CRUD                                                       */
/* ------------------------------------------------------------------ */

describe("Docker: Vehicle CRUD", () => {
  const vehicleId = `int-test-v-${Date.now()}`;

  it("POST /api/vehicles — creates a vehicle", async () => {
    const { status, body } = await http.post<{ vehicle: { id: string }; rev: number }>("/api/vehicles", {
      id: vehicleId,
      name: "Integration-Test-Truck",
      capacity_kg: 500,
      start_location: { lat: 40.7128, lng: -74.006 },
    });

    expect(status).toBe(201);
    expect(body.vehicle.id).toBe(vehicleId);
  });

  it("PUT /api/vehicles/:id — updates the vehicle", async () => {
    const rev = await getCurrentRev();
    const { status } = await http.put(`/api/vehicles/${vehicleId}`, {
      name: "Integration-Test-Truck-Updated",
      capacity_kg: 750,
      start_location: { lat: 40.7128, lng: -74.006 },
      baseRev: rev,
    });

    expect(status).toBe(200);
  });

  it("DELETE /api/vehicles/:id — removes the vehicle", async () => {
    const rev = await getCurrentRev();
    const { status } = await http.del(`/api/vehicles/${vehicleId}?baseRev=${rev}`);
    expect(status).toBe(200);
  });
});

/* ------------------------------------------------------------------ */
/*  Order CRUD                                                         */
/* ------------------------------------------------------------------ */

describe("Docker: Order CRUD", () => {
  const orderId = `int-test-o-${Date.now()}`;

  it("POST /api/orders — creates an order", async () => {
    const { status, body } = await http.post<{ order: { id: string }; rev: number }>("/api/orders", {
      id: orderId,
      weight_kg: 10,
      location: { lat: 34.0522, lng: -118.2437 },
      service_time_min: 15,
    });

    expect(status).toBe(201);
    expect(body.order.id).toBe(orderId);
  });

  it("PUT /api/orders/:id — updates the order", async () => {
    const rev = await getCurrentRev();
    const { status } = await http.put(`/api/orders/${orderId}`, {
      weight_kg: 20,
      location: { lat: 34.0522, lng: -118.2437 },
      service_time_min: 30,
      baseRev: rev,
    });

    expect(status).toBe(200);
  });

  it("DELETE /api/orders/:id — removes the order", async () => {
    const rev = await getCurrentRev();
    const { status } = await http.del(`/api/orders/${orderId}?baseRev=${rev}`);
    expect(status).toBe(200);
  });
});

/* ------------------------------------------------------------------ */
/*  Validation errors (generates 4xx metrics)                          */
/* ------------------------------------------------------------------ */

describe("Docker: Error responses", () => {
  it("POST /api/vehicles with invalid body → 422", async () => {
    const { status } = await http.post("/api/vehicles", { bad: "data" });
    expect(status).toBe(422);
  });

  it("DELETE /api/vehicles/:id with non-existent id → 404", async () => {
    const rev = await getCurrentRev();
    const { status } = await http.del(`/api/vehicles/nonexistent-id?baseRev=${rev}`);
    expect(status).toBe(404);
  });
});

/* ------------------------------------------------------------------ */
/*  Save                                                               */
/* ------------------------------------------------------------------ */

describe("Docker: POST /api/save", () => {
  it("persists current state to MongoDB", async () => {
    const { status, body } = await http.post<{ success: boolean; savedRev: number }>("/api/save");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(typeof body.savedRev).toBe("number");
  });
});
