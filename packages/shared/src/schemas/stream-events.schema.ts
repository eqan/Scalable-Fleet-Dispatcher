import { z } from "zod";

export const OptimizeEventSchema = z.object({
  type: z.literal("optimize_route"),
  vehicleId: z.string().min(1),
  requestId: z.string().min(1),
  baseRev: z.number().int(),
  timestamp: z.number(),
});

export type OptimizeEvent = z.infer<typeof OptimizeEventSchema>;

export const ResultEventSchema = z.object({
  type: z.literal("route_optimized"),
  vehicleId: z.string().min(1),
  route: z.array(z.string()),
  requestId: z.string().min(1),
  baseRev: z.number().int(),
  timestamp: z.number(),
});

export type ResultEvent = z.infer<typeof ResultEventSchema>;

