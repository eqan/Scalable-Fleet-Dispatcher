import { Router } from "express";
import type { IDraftStore } from "../../domain/ports/draft-store.port.ts";
import type { IRealtimeGateway } from "../../domain/ports/realtime.port.ts";
import { AssignRequestSchema } from "@repo/shared";
import { validate } from "../middleware/validate.ts";
import { createAssignmentService } from "../../application/services/assignment.service.ts";
import { createAssignmentController } from "../controllers/assignment.controller.ts";

/**
 * Assignment route factory.
 * Wires: Ports → Service → Controller → Router (DIP).
 */
export const createAssignmentRoutes = (deps: {
  draftStore: IDraftStore;
  gateway: IRealtimeGateway;
}): Router => {
  const router = Router();
  const service = createAssignmentService(deps);
  const ctrl = createAssignmentController(service);

  router.post("/assign", validate({ body: AssignRequestSchema }), ctrl.assign);

  return router;
};
