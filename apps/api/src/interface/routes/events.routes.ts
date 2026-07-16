import { Router } from "express";
import type { IRealtimeGateway } from "../../domain/ports/realtime.port.ts";
import { createEventsController } from "../controllers/events.controller.ts";

/**
 * SSE events route factory.
 * GET /api/events opens a Server-Sent Events stream.
 * Clients receive real-time state_changed events after every mutation.
 */
export const createEventsRoutes = (gateway: IRealtimeGateway): Router => {
  const router = Router();
  const ctrl = createEventsController(gateway);

  router.get("/events", ctrl.subscribe);

  return router;
};
