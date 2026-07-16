import { Router } from "express";
import type { IDraftStore } from "../../domain/ports/draft-store.port.ts";
import type { IRealtimeGateway } from "../../domain/ports/realtime.port.ts";
import {
  CreateOrderBodySchema,
  UpdateOrderBodySchema,
  IdParamSchema,
  BaseRevQuerySchema,
} from "@repo/shared";
import { validate } from "../middleware/validate.ts";
import { createOrderService } from "../../application/services/order.service.ts";
import { createOrderController } from "../controllers/order.controller.ts";

/**
 * Order CRUD route factory.
 * Zod validation middleware guards every endpoint (Open/Closed -- easy to extend).
 */
export const createOrderRoutes = (deps: {
  draftStore: IDraftStore;
  gateway: IRealtimeGateway;
}): Router => {
  const router = Router();
  const service = createOrderService(deps);
  const ctrl = createOrderController(service);

  router.post(
    "/orders",
    validate({ body: CreateOrderBodySchema }),
    ctrl.create,
  );

  router.put(
    "/orders/:id",
    validate({ body: UpdateOrderBodySchema, params: IdParamSchema }),
    ctrl.update,
  );

  router.delete(
    "/orders/:id",
    validate({ params: IdParamSchema, query: BaseRevQuerySchema }),
    ctrl.remove,
  );

  return router;
};
