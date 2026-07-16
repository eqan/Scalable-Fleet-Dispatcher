import type { Request, Response, NextFunction } from "express";
import type { OptimizationService } from "../../application/services/optimization.service.ts";
import type { OptimizeRequest } from "@repo/shared";
import { sendResult } from "../helpers.ts";

/**
 * Thin controller for POST /api/optimize.
 * Returns 202 Accepted -- the actual work happens asynchronously in the worker.
 */
export const createOptimizationController = (service: OptimizationService) => ({
  optimize: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const body = req.body as OptimizeRequest;
    sendResult(await service.requestOptimization(body), res, next, 202);
  },
});
