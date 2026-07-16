/**
 * useCrudMutations -- DRY mutation hooks for Vehicle and Order CRUD.
 *
 * All four operations (create, update, delete) for both entities
 * follow the same pattern:
 *   1. Call api.* method
 *   2. On success: invalidate hotState query (SSE will also do this)
 *   3. Mark state as dirty
 *
 * DRY: one factory function `useCrudMutation` handles the pattern.
 * Each specific mutation just provides its API call.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateVehicleBody,
  UpdateVehicleBody,
  CreateOrderBody,
  UpdateOrderBody,
} from "@repo/shared";
import { api, ApiError } from "../lib/api.ts";
import { QUERY_KEYS } from "./useHotState.ts";
import { useUIStore } from "../stores/ui.store.ts";
import { useToastStore } from "../stores/toast.store.ts";

/* ------------------------------------------------------------------ */
/*  Generic CRUD mutation factory (DRY core)                           */
/* ------------------------------------------------------------------ */

function useCrudMutation<TArgs>(
  mutationFn: (args: TArgs) => Promise<unknown>,
  entityLabel: string,
  actionLabel: string,
) {
  const queryClient = useQueryClient();
  const markDirty = useUIStore((s) => s.markDirty);
  const addToast = useToastStore((s) => s.addToast);

  return useMutation({
    mutationFn,
    onSuccess: () => {
      markDirty();
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.hotState });
      addToast({
        variant: "success",
        title: `${entityLabel} ${actionLabel}`,
      });
    },
    onError: (err) => {
      addToast({
        variant: "error",
        title: `Failed to ${actionLabel.toLowerCase()} ${entityLabel.toLowerCase()}`,
        description: err instanceof ApiError ? err.message : "An unexpected error occurred",
      });
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Vehicle mutations                                                  */
/* ------------------------------------------------------------------ */

export function useCreateVehicle() {
  return useCrudMutation(
    (body: CreateVehicleBody) => api.createVehicle(body),
    "Vehicle",
    "created",
  );
}

export function useUpdateVehicle() {
  return useCrudMutation(
    ({ id, body }: { id: string; body: UpdateVehicleBody }) =>
      api.updateVehicle(id, body),
    "Vehicle",
    "updated",
  );
}

export function useDeleteVehicle() {
  return useCrudMutation(
    ({ id, baseRev }: { id: string; baseRev?: number }) =>
      api.deleteVehicle(id, baseRev),
    "Vehicle",
    "deleted",
  );
}

/* ------------------------------------------------------------------ */
/*  Order mutations                                                    */
/* ------------------------------------------------------------------ */

export function useCreateOrder() {
  return useCrudMutation(
    (body: CreateOrderBody) => api.createOrder(body),
    "Order",
    "created",
  );
}

export function useUpdateOrder() {
  return useCrudMutation(
    ({ id, body }: { id: string; body: UpdateOrderBody }) =>
      api.updateOrder(id, body),
    "Order",
    "updated",
  );
}

export function useDeleteOrder() {
  return useCrudMutation(
    ({ id, baseRev }: { id: string; baseRev?: number }) =>
      api.deleteOrder(id, baseRev),
    "Order",
    "deleted",
  );
}
