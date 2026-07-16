/**
 * Typed API client -- single point of contact for all backend endpoints.
 *
 * Design principles:
 *   - DRY: One generic `request()` handles fetch + JSON + error wrapping.
 *   - Type-safe: Every endpoint function returns the exact inferred Zod type.
 *   - Boundary validation: Responses are Zod-parsed so malformed data fails
 *     fast at the network boundary, not deep inside a React component.
 *   - Open/Closed: Adding a new endpoint = one new function, nothing else changes.
 */

import type { ZodType } from "zod";
import {
  StateResponseSchema,
  AssignResponseSchema,
  OptimizeResponseSchema,
  SaveResponseSchema,
  VehicleResponseSchema,
  DeleteVehicleResponseSchema,
  OrderResponseSchema,
  DeleteResponseSchema,
  type StateResponse,
  type AssignRequest,
  type AssignResponse,
  type CreateVehicleBody,
  type UpdateVehicleBody,
  type VehicleResponse,
  type DeleteVehicleResponse,
  type CreateOrderBody,
  type UpdateOrderBody,
  type OrderResponse,
  type DeleteResponse,
  type OptimizeRequest,
  type OptimizeResponse,
  type SaveResponse,
} from "@repo/shared";

/* ------------------------------------------------------------------ */
/*  Error type                                                         */
/* ------------------------------------------------------------------ */

/** Structured API error -- carries status, code, and message for UI display. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/* ------------------------------------------------------------------ */
/*  Generic request helper (DRY core)                                  */
/* ------------------------------------------------------------------ */

/**
 * Generic fetch wrapper with Zod response validation.
 *
 * - Parses JSON and validates against the provided schema.
 * - Wraps non-OK responses into a structured `ApiError`.
 * - Accepts any `RequestInit` overrides for method, body, headers.
 */
async function request<T>(
  url: string,
  schema: ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });

  if (!res.ok) {
    let body: { code?: string; message?: string; details?: unknown } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      /* non-JSON error response -- ignore */
    }
    throw new ApiError(
      res.status,
      body.code ?? "UNKNOWN",
      body.message ?? `Request failed (${res.status})`,
      body.details,
    );
  }

  const json: unknown = await res.json();
  return schema.parse(json);
}

/** DRY helper for JSON POST/PUT bodies. */
const jsonBody = (data: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(data),
});

/* ------------------------------------------------------------------ */
/*  Public API client                                                  */
/* ------------------------------------------------------------------ */

export const api = {
  /* ---- State ---- */
  getState: (): Promise<StateResponse> =>
    request("/api/state", StateResponseSchema),

  /* ---- Assignment ---- */
  assign: (body: AssignRequest): Promise<AssignResponse> =>
    request("/api/assign", AssignResponseSchema, jsonBody(body)),

  /* ---- Optimization ---- */
  optimize: (body: OptimizeRequest): Promise<OptimizeResponse> =>
    request("/api/optimize", OptimizeResponseSchema, jsonBody(body)),

  /* ---- Save Plan ---- */
  save: (): Promise<SaveResponse> =>
    request("/api/save", SaveResponseSchema, { method: "POST" }),

  /* ---- Vehicle CRUD ---- */
  createVehicle: (body: CreateVehicleBody): Promise<VehicleResponse> =>
    request("/api/vehicles", VehicleResponseSchema, jsonBody(body)),

  updateVehicle: (id: string, body: UpdateVehicleBody): Promise<VehicleResponse> =>
    request(`/api/vehicles/${encodeURIComponent(id)}`, VehicleResponseSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  deleteVehicle: (id: string, baseRev?: number): Promise<DeleteVehicleResponse> => {
    const params = baseRev != null ? `?baseRev=${baseRev}` : "";
    return request(
      `/api/vehicles/${encodeURIComponent(id)}${params}`,
      DeleteVehicleResponseSchema,
      { method: "DELETE" },
    );
  },

  /* ---- Order CRUD ---- */
  createOrder: (body: CreateOrderBody): Promise<OrderResponse> =>
    request("/api/orders", OrderResponseSchema, jsonBody(body)),

  updateOrder: (id: string, body: UpdateOrderBody): Promise<OrderResponse> =>
    request(`/api/orders/${encodeURIComponent(id)}`, OrderResponseSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  deleteOrder: (id: string, baseRev?: number): Promise<DeleteResponse> => {
    const params = baseRev != null ? `?baseRev=${baseRev}` : "";
    return request(
      `/api/orders/${encodeURIComponent(id)}${params}`,
      DeleteResponseSchema,
      { method: "DELETE" },
    );
  },
} as const;

