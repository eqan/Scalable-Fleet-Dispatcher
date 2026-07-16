import type { Request, Response, NextFunction } from "express";
import type { StateService } from "../../application/services/state.service.ts";
import { sendResult } from "../helpers.ts";

/**
 * Thin controller for the GET /api/state endpoint.
 * Delegates to StateService and uses sendResult for consistent response handling (DRY).
 */
export const createStateController = (stateService: StateService) => ({
  getState: async (
    _req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    sendResult(await stateService.getFullState(), res, next);
  },
});
