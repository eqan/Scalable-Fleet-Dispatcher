import { Router } from "express";
import type { IDraftStore } from "../../domain/ports/draft-store.port.ts";
import type { IDurableStore } from "../../domain/ports/durable-store.port.ts";
import type { IRealtimeGateway } from "../../domain/ports/realtime.port.ts";
import { createSavePlanService } from "../../application/services/save-plan.service.ts";
import { createSaveController } from "../controllers/save.controller.ts";

/**
 * Save route factory.
 * Wires: Ports → SavePlanService → SaveController → Router (DIP).
 */
export const createSaveRoutes = (deps: {
  draftStore: IDraftStore;
  durableStore: IDurableStore;
  gateway: IRealtimeGateway;
}): Router => {
  const router = Router();
  const service = createSavePlanService(deps);
  const ctrl = createSaveController(service);

  router.post("/save", ctrl.save);

  return router;
};
