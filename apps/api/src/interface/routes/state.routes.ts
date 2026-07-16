import { Router } from "express";
import type { IDraftStore } from "../../domain/ports/draft-store.port.ts";
import { createStateService } from "../../application/services/state.service.ts";
import { createStateController } from "../controllers/state.controller.ts";

/**
 * State route factory.
 * Wires: IDraftStore (port) → StateService → StateController → Router.
 * Dependencies are injected (Dependency Inversion), not imported.
 */
export const createStateRoutes = (draftStore: IDraftStore): Router => {
  const router = Router();
  const service = createStateService({ draftStore });
  const controller = createStateController(service);

  router.get("/state", controller.getState);

  return router;
};
