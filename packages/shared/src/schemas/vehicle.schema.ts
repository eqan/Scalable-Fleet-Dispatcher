import { z } from "zod";
import { LocationSchema } from "./location.schema.ts";

export const VehicleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  capacity_kg: z.number().positive(),
  start_location: LocationSchema,
});

export type Vehicle = z.infer<typeof VehicleSchema>;

// Used for POST /api/vehicles -- client provides all fields including id.
export const CreateVehicleSchema = VehicleSchema;

// Used for PUT /api/vehicles/:id -- id comes from URL param.
export const UpdateVehicleSchema = VehicleSchema.omit({ id: true });
