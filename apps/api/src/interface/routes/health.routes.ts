import { Router } from "express";
import {
  createHealthController,
  type Pingable,
} from "../controllers/health.controller.ts";

export const createHealthRoutes = (deps: {
  draftStore: Pingable;
  durableStore: Pingable;
}): Router => {
  const router = Router();
  const controller = createHealthController(deps);
  router.get("/live", controller.live);
  router.get("/health", controller.check);
  return router;
};
