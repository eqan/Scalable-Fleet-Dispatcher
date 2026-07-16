import type { Request, Response, NextFunction } from "express";
import type { OrderService } from "../../application/services/order.service.ts";
import type {
  CreateOrderBody,
  UpdateOrderBody,
  BaseRevQuery,
} from "@repo/shared";
import { sendResult } from "../helpers.ts";

/**
 * Thin controller for order CRUD endpoints.
 * Each method: extract validated data → call service → send result (SRP).
 */
export const createOrderController = (service: OrderService) => ({
  create: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const body = req.body as CreateOrderBody;
    sendResult(await service.create(body), res, next, 201);
  },

  update: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const { id } = req.params as { id: string };
    const body = req.body as UpdateOrderBody;
    sendResult(await service.update(id, body), res, next);
  },

  remove: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const { id } = req.params as { id: string };
    const { baseRev } = req.query as unknown as BaseRevQuery;
    sendResult(await service.remove(id, baseRev), res, next);
  },
});
