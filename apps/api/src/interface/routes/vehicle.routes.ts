import { Router } from "express";
import type { IDraftStore } from "../../domain/ports/draft-store.port.ts";
import type { IRealtimeGateway } from "../../domain/ports/realtime.port.ts";
import {
  CreateVehicleBodySchema,
  UpdateVehicleBodySchema,
  IdParamSchema,
  BaseRevQuerySchema,
} from "@repo/shared";
import { validate } from "../middleware/validate.ts";
import { createVehicleService } from "../../application/services/vehicle.service.ts";
import { createVehicleController } from "../controllers/vehicle.controller.ts";

/**
 * Vehicle CRUD route factory.
 * Zod validation middleware guards every endpoint (Open/Closed -- easy to extend).
 */
export const createVehicleRoutes = (deps: {
  draftStore: IDraftStore;
  gateway: IRealtimeGateway;
}): Router => {
  const router = Router();
  const service = createVehicleService(deps);
  const ctrl = createVehicleController(service);

  router.post(
    "/vehicles",
    validate({ body: CreateVehicleBodySchema }),
    ctrl.create,
  );

  router.put(
    "/vehicles/:id",
    validate({ body: UpdateVehicleBodySchema, params: IdParamSchema }),
    ctrl.update,
  );

  router.delete(
    "/vehicles/:id",
    validate({ params: IdParamSchema, query: BaseRevQuerySchema }),
    ctrl.remove,
  );

  return router;
};
