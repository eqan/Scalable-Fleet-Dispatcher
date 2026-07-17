import { Router } from "express";
import {
  createHealthController,
  type Pingable,
} from "../controllers/health.controller.ts";

/**
 * Health-check route factory.
 * Accepts minimal Pingable interfaces (ISP) -- no dependency on
 * concrete Redis/Mongo clients (DIP).
 */
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
