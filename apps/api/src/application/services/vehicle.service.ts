import type { IDraftStore } from "../../domain/ports/draft-store.port.ts";
import type { IRealtimeGateway } from "../../domain/ports/realtime.port.ts";
import type {
  Vehicle,
  CreateVehicleBody,
  UpdateVehicleBody,
} from "@repo/shared";
import type { AppError } from "../../domain/errors.ts";
import type { Result } from "../../shared/result.ts";
import { AppError as AppErrorClass } from "../../domain/errors.ts";
import { tryCatch } from "../helpers.ts";

/* ------------------------------------------------------------------ */
/*  Dependencies                                                       */
/* ------------------------------------------------------------------ */

export interface VehicleServiceDeps {
  draftStore: IDraftStore;
  gateway: IRealtimeGateway;
}

/* ------------------------------------------------------------------ */
/*  Service factory                                                    */
/* ------------------------------------------------------------------ */

export const createVehicleService = (deps: VehicleServiceDeps) => ({
  /**
   * Create a new vehicle. Returns 409 if the ID already exists.
   */
  create: async (
    body: CreateVehicleBody,
  ): Promise<Result<{ vehicle: Vehicle; rev: number }, AppError>> => {
    const { baseRev, ...vehicleData } = body;

    return tryCatch(async () => {
      const existing = await deps.draftStore.getVehicle(vehicleData.id);
      if (existing) {
        throw AppErrorClass.conflict(
          `Vehicle '${vehicleData.id}' already exists`,
        );
      }

      const { rev } = await deps.draftStore.setVehicle(vehicleData, baseRev);

      deps.gateway.broadcast({
        kind: "vehicle_created",
        rev,
        vehicleId: vehicleData.id,
      });

      return { vehicle: vehicleData, rev };
    });
  },

  /**
   * Update an existing vehicle. Returns 404 if not found.
   * Merges the existing data with the update payload.
   */
  update: async (
    id: string,
    body: UpdateVehicleBody,
  ): Promise<Result<{ vehicle: Vehicle; rev: number }, AppError>> => {
    const { baseRev, ...updateData } = body;

    return tryCatch(async () => {
      const existing = await deps.draftStore.getVehicle(id);
      if (!existing) {
        throw AppErrorClass.notFound("Vehicle", id);
      }

      const merged: Vehicle = { ...existing, ...updateData };
      const { rev } = await deps.draftStore.setVehicle(merged, baseRev);

      deps.gateway.broadcast({
        kind: "vehicle_updated",
        rev,
        vehicleId: id,
        data: merged,
      });

      return { vehicle: merged, rev };
    });
  },

  /**
   * Delete a vehicle and unassign all its orders.
   * Returns 404 (via Lua) if not found.
   */
  remove: async (
    id: string,
    baseRev?: number,
  ): Promise<
    Result<{ unassignedOrderIds: string[]; rev: number }, AppError>
  > => {
    return tryCatch(async () => {
      const { unassignedOrderIds, rev } = await deps.draftStore.deleteVehicle(
        id,
        baseRev,
      );

      deps.gateway.broadcast({
        kind: "vehicle_deleted",
        rev,
        vehicleId: id,
        data: { unassignedOrderIds },
      });

      return { unassignedOrderIds, rev };
    });
  },
});

export type VehicleService = ReturnType<typeof createVehicleService>;
