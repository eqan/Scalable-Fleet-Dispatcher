import { z } from "zod";

export const AssignmentSchema = z.object({
  vehicle_id: z.string().min(1),
  route: z.array(z.string().min(1)),
});

export type Assignment = z.infer<typeof AssignmentSchema>;
