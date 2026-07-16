import type { IDraftStore } from "../../domain/ports/draft-store.port.ts";
import type { IRealtimeGateway } from "../../domain/ports/realtime.port.ts";
import type {
  Order,
  CreateOrderBody,
  UpdateOrderBody,
} from "@repo/shared";
import type { AppError } from "../../domain/errors.ts";
import type { Result } from "../../shared/result.ts";
import { AppError as AppErrorClass } from "../../domain/errors.ts";
import { tryCatch } from "../helpers.ts";

/* ------------------------------------------------------------------ */
/*  Dependencies                                                       */
/* ------------------------------------------------------------------ */

export interface OrderServiceDeps {
  draftStore: IDraftStore;
  gateway: IRealtimeGateway;
}

/* ------------------------------------------------------------------ */
/*  Service factory                                                    */
/* ------------------------------------------------------------------ */

export const createOrderService = (deps: OrderServiceDeps) => ({
  /**
   * Create a new order. Returns 409 if the ID already exists.
   * New orders are automatically added to the unassigned pool by the Lua script.
   */
  create: async (
    body: CreateOrderBody,
  ): Promise<Result<{ order: Order; rev: number }, AppError>> => {
    const { baseRev, ...orderData } = body;

    return tryCatch(async () => {
      const existing = await deps.draftStore.getOrder(orderData.id);
      if (existing) {
        throw AppErrorClass.conflict(
          `Order '${orderData.id}' already exists`,
        );
      }

      const { rev } = await deps.draftStore.setOrder(orderData, baseRev);

      deps.gateway.broadcast({
        kind: "order_created",
        rev,
        orderId: orderData.id,
      });

      return { order: orderData, rev };
    });
  },

  /**
   * Update an existing order. Returns 404 if not found.
   * Merges the existing data with the update payload.
   * Assignment state is preserved (the order stays wherever it is).
   */
  update: async (
    id: string,
    body: UpdateOrderBody,
  ): Promise<Result<{ order: Order; rev: number }, AppError>> => {
    const { baseRev, ...updateData } = body;

    return tryCatch(async () => {
      const existing = await deps.draftStore.getOrder(id);
      if (!existing) {
        throw AppErrorClass.notFound("Order", id);
      }

      const merged: Order = { ...existing, ...updateData };
      const { rev } = await deps.draftStore.setOrder(merged, baseRev);

      deps.gateway.broadcast({
        kind: "order_updated",
        rev,
        orderId: id,
        data: merged,
      });

      return { order: merged, rev };
    });
  },

  /**
   * Delete an order. Removes it from its route or the unassigned pool.
   * Returns 404 (via Lua) if not found.
   */
  remove: async (
    id: string,
    baseRev?: number,
  ): Promise<Result<{ rev: number }, AppError>> => {
    return tryCatch(async () => {
      const { rev } = await deps.draftStore.deleteOrder(id, baseRev);

      deps.gateway.broadcast({
        kind: "order_deleted",
        rev,
        orderId: id,
      });

      return { rev };
    });
  },
});

export type OrderService = ReturnType<typeof createOrderService>;
