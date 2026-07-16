/**
 * @repo/shared -- Single source of truth for domain types & Zod schemas.
 *
 * Both the API (apps/api) and the Web UI (apps/web) import from here.
 * Types are INFERRED from Zod schemas so they can never drift.
 */

/* ------------------------------------------------------------------ */
/*  Schemas                                                            */
/* ------------------------------------------------------------------ */

export { LocationSchema } from "./schemas/location.schema.ts";

export {
  VehicleSchema,
  CreateVehicleSchema,
  UpdateVehicleSchema,
} from "./schemas/vehicle.schema.ts";

export {
  OrderSchema,
  CreateOrderSchema,
  UpdateOrderSchema,
} from "./schemas/order.schema.ts";

export { AssignmentSchema } from "./schemas/assignment.schema.ts";
export { SolutionSchema } from "./schemas/solution.schema.ts";

export {
  OptimizeEventSchema,
  ResultEventSchema,
} from "./schemas/stream-events.schema.ts";

export {
  IdParamSchema,
  BaseRevQuerySchema,
  StateResponseSchema,
  AssignRequestSchema,
  AssignResponseSchema,
  CreateVehicleBodySchema,
  UpdateVehicleBodySchema,
  VehicleResponseSchema,
  DeleteVehicleResponseSchema,
  CreateOrderBodySchema,
  UpdateOrderBodySchema,
  OrderResponseSchema,
  DeleteResponseSchema,
  OptimizeRequestSchema,
  OptimizeResponseSchema,
  SaveResponseSchema,
} from "./schemas/api.schema.ts";

/* ------------------------------------------------------------------ */
/*  Types (inferred from schemas -- DRY)                               */
/* ------------------------------------------------------------------ */

export type { Location } from "./schemas/location.schema.ts";
export type { Vehicle } from "./schemas/vehicle.schema.ts";
export type { Order } from "./schemas/order.schema.ts";
export type { Assignment } from "./schemas/assignment.schema.ts";
export type { Solution } from "./schemas/solution.schema.ts";
export type { OptimizeEvent, ResultEvent } from "./schemas/stream-events.schema.ts";
export type {
  StateResponse,
  AssignRequest,
  AssignResponse,
  CreateVehicleBody,
  UpdateVehicleBody,
  VehicleResponse,
  DeleteVehicleResponse,
  CreateOrderBody,
  UpdateOrderBody,
  OrderResponse,
  DeleteResponse,
  BaseRevQuery,
  OptimizeRequest,
  OptimizeResponse,
  SaveResponse,
} from "./schemas/api.schema.ts";
