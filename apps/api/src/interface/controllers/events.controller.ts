import type { Request, Response } from "express";
import type { IRealtimeGateway } from "../../domain/ports/realtime.port.ts";

/**
 * SSE controller for GET /api/events.
 *
 * Opens a long-lived text/event-stream connection.
 * The SseGateway handles headers, Last-Event-ID,
 * client registration, and cleanup on disconnect.
 */
export const createEventsController = (gateway: IRealtimeGateway) => ({
  subscribe: (req: Request, res: Response): void => {
    gateway.addClient(req, res);
  },
});
