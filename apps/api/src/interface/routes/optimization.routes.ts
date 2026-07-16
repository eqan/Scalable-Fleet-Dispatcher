import { Router } from "express";
import type { IDraftStore } from "../../domain/ports/draft-store.port.ts";
import type { IStreamPublisher } from "../../domain/ports/stream-publisher.port.ts";
import { OptimizeRequestSchema } from "@repo/shared";
import { validate } from "../middleware/validate.ts";
import { createOptimizationService } from "../../application/services/optimization.service.ts";
import { createOptimizationController } from "../controllers/optimization.controller.ts";

/**
 * Optimization route factory.
 * Wires: Ports → Service → Controller → Router (DIP).
 */
export const createOptimizationRoutes = (deps: {
  draftStore: IDraftStore;
  streamPublisher: IStreamPublisher;
}): Router => {
  const router = Router();
  const service = createOptimizationService(deps);
  const ctrl = createOptimizationController(service);

  router.post(
    "/optimize",
    validate({ body: OptimizeRequestSchema }),
    ctrl.optimize,
  );

  return router;
};
