import type { Request, Response, NextFunction } from "express";
import type { SavePlanService } from "../../application/services/save-plan.service.ts";
import { sendResult } from "../helpers.ts";

/**
 * Thin controller for POST /api/save.
 * Persists the current Redis state to MongoDB (DRY -- uses sendResult).
 */
export const createSaveController = (service: SavePlanService) => ({
  save: async (
    _req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    sendResult(await service.save(), res, next);
  },
});
