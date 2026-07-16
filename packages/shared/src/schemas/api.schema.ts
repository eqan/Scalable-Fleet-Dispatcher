import { z } from "zod";
import { VehicleSchema } from "./vehicle.schema.ts";
import { OrderSchema } from "./order.schema.ts";
import { SolutionSchema } from "./solution.schema.ts";

/* ------------------------------------------------------------------ */
/*  DRY mixin: adds optional baseRev for Optimistic Concurrency       */
/* ------------------------------------------------------------------ */

const baseRevField = { baseRev: z.number().int().nonnegative().optional() } as const;

/* ------------------------------------------------------------------ */
/*  Shared param / query schemas                                       */
/* ------------------------------------------------------------------ */

export const IdParamSchema = z.object({
  id: z.string().min(1),
});

/** Query schema for DELETE endpoints (baseRev comes as a query string). */
export const BaseRevQuerySchema = z.object({
  baseRev: z.coerce.number().int().nonnegative().optional(),
});

export type BaseRevQuery = z.infer<typeof BaseRevQuerySchema>;

/* ------------------------------------------------------------------ */
/*  GET /api/state                                                     */
/* ------------------------------------------------------------------ */

export const StateResponseSchema = z.object({
  vehicles: z.array(VehicleSchema),
  orders: z.array(OrderSchema),
  solution: SolutionSchema,
  unassignedOrderIds: z.array(z.string()),
  rev: z.number(),
});

export type StateResponse = z.infer<typeof StateResponseSchema>;

/* ------------------------------------------------------------------ */
/*  POST /api/assign                                                   */
/* ------------------------------------------------------------------ */

export const AssignRequestSchema = z.object({
  orderId: z.string().min(1),
  vehicleId: z.string().min(1), // "UNASSIGNED" to unassign
  position: z.number().int().nonnegative().optional(),
  ...baseRevField,
});

export type AssignRequest = z.infer<typeof AssignRequestSchema>;

export const AssignResponseSchema = z.object({
  rev: z.number(),
  success: z.boolean(),
});

export type AssignResponse = z.infer<typeof AssignResponseSchema>;

/* ------------------------------------------------------------------ */
/*  Vehicle mutations                                                  */
/* ------------------------------------------------------------------ */

export const CreateVehicleBodySchema = VehicleSchema.extend(baseRevField);
export type CreateVehicleBody = z.infer<typeof CreateVehicleBodySchema>;

export const UpdateVehicleBodySchema = VehicleSchema.omit({ id: true }).extend(baseRevField);
export type UpdateVehicleBody = z.infer<typeof UpdateVehicleBodySchema>;

/** Response for vehicle create / update: `{ vehicle, rev }`. */
export const VehicleResponseSchema = z.object({
  vehicle: VehicleSchema,
  rev: z.number(),
});

export type VehicleResponse = z.infer<typeof VehicleResponseSchema>;

/** Response for vehicle delete: `{ unassignedOrderIds, rev }`. */
export const DeleteVehicleResponseSchema = z.object({
  unassignedOrderIds: z.array(z.string()),
  rev: z.number(),
});

export type DeleteVehicleResponse = z.infer<typeof DeleteVehicleResponseSchema>;

/* ------------------------------------------------------------------ */
/*  Order mutations                                                    */
/* ------------------------------------------------------------------ */

export const CreateOrderBodySchema = OrderSchema.extend(baseRevField);
export type CreateOrderBody = z.infer<typeof CreateOrderBodySchema>;

export const UpdateOrderBodySchema = OrderSchema.omit({ id: true }).extend(baseRevField);
export type UpdateOrderBody = z.infer<typeof UpdateOrderBodySchema>;

/** Response for order create / update: `{ order, rev }`. */
export const OrderResponseSchema = z.object({
  order: OrderSchema,
  rev: z.number(),
});

export type OrderResponse = z.infer<typeof OrderResponseSchema>;

/** Response for entity delete (order): `{ rev }`. */
export const DeleteResponseSchema = z.object({
  rev: z.number(),
});

export type DeleteResponse = z.infer<typeof DeleteResponseSchema>;

/* ------------------------------------------------------------------ */
/*  POST /api/optimize                                                 */
/* ------------------------------------------------------------------ */

export const OptimizeRequestSchema = z.object({
  vehicleId: z.string().min(1),
});

export type OptimizeRequest = z.infer<typeof OptimizeRequestSchema>;

export const OptimizeResponseSchema = z.object({
  requestId: z.string(),
  eventId: z.string(),
});

export type OptimizeResponse = z.infer<typeof OptimizeResponseSchema>;

/* ------------------------------------------------------------------ */
/*  POST /api/save                                                     */
/* ------------------------------------------------------------------ */

export const SaveResponseSchema = z.object({
  success: z.boolean(),
  savedRev: z.number(),
  savedAt: z.string(),
});

export type SaveResponse = z.infer<typeof SaveResponseSchema>;
