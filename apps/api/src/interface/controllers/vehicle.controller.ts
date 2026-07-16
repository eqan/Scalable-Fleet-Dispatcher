import type { Request, Response, NextFunction } from "express";
import type { VehicleService } from "../../application/services/vehicle.service.ts";
import type {
  CreateVehicleBody,
  UpdateVehicleBody,
  BaseRevQuery,
} from "@repo/shared";
import { sendResult } from "../helpers.ts";

/**
 * Thin controller for vehicle CRUD endpoints.
 * Each method: extract validated data → call service → send result (SRP).
 */
export const createVehicleController = (service: VehicleService) => ({
  create: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const body = req.body as CreateVehicleBody;
    sendResult(await service.create(body), res, next, 201);
  },

  update: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const { id } = req.params as { id: string };
    const body = req.body as UpdateVehicleBody;
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
