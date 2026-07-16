import type { Request, Response } from "express";

export interface StateChangeEvent {
  kind: string;
  rev: number;
  vehicleId?: string;
  orderId?: string;
  data?: unknown;
}

/**
 * Port: Server-Sent Events gateway for real-time UI updates.
 */
export interface IRealtimeGateway {
  // Register a new SSE client connection. 
  addClient(req: Request, res: Response): void;

  // Broadcast a state change to all connected clients.
  broadcast(event: StateChangeEvent): void;

  // Number of currently connected clients
  getClientCount(): number;
}
