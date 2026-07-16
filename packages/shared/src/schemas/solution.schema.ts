import { z } from "zod";
import { AssignmentSchema } from "./assignment.schema.ts";

export const SolutionSchema = z.object({
  assignments: z.array(AssignmentSchema),
});

export type Solution = z.infer<typeof SolutionSchema>;
