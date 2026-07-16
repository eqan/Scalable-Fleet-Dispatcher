import { z } from "zod";
import { LocationSchema } from "./location.schema.ts";

export const OrderSchema = z.object({
  id: z.string().min(1),
  weight_kg: z.number().positive(),
  location: LocationSchema,
  service_time_min: z.number().nonnegative(),
});

export type Order = z.infer<typeof OrderSchema>;

// Used for POST /api/orders -- client provides all fields including id.
export const CreateOrderSchema = OrderSchema;

// Used for PUT /api/orders/:id -- id comes from URL param.
export const UpdateOrderSchema = OrderSchema.omit({ id: true });
