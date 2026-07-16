import type { Request, Response, NextFunction } from "express";
import type { AssignmentService } from "../../application/services/assignment.service.ts";
import type { AssignRequest } from "@repo/shared";
import { sendResult } from "../helpers.ts";

/**
 * Thin controller for POST /api/assign.
 * No business logic -- just request unwrapping and response sending (SRP).
 */
export const createAssignmentController = (service: AssignmentService) => ({
  assign: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const body = req.body as AssignRequest;
    sendResult(await service.assignOrder(body), res, next);
  },
});
