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

  // Broadcast a state change to all connected clients (all API replicas).
  broadcast(event: StateChangeEvent): void;

  // Number of currently connected clients on this process.
  getClientCount(): number;

  /** Subscribe to the cross-replica live channel (call once at boot). */
  start(): Promise<void>;

  /** Unsubscribe / close the subscriber connection. */
  stop(): Promise<void>;
}
