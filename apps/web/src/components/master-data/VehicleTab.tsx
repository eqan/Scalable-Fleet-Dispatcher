/**
 * VehicleTab -- vehicle list + create/edit form inside the Master Data drawer.
 *
 * UX flow:
 *   - Default: shows list of vehicles with Edit/Delete actions
 *   - "Add Vehicle" or "Edit" → shows form (replaces list)
 *   - "Cancel" or successful submit → returns to list
 *
 * Validation: Zod VehicleSchema via our custom zodResolver (DRY).
 * Mutations: useCrudMutations hooks (DRY factory pattern).
 */

import { useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { VehicleSchema, type Vehicle } from "@repo/shared";
import { zodResolver, coerceNumbers } from "../../lib/form.ts";
import { useCreateVehicle, useUpdateVehicle, useDeleteVehicle } from "../../hooks/useCrudMutations.ts";
import { useUIStore } from "../../stores/ui.store.ts";
import { FormField } from "../shared/FormField.tsx";
import { EmptyState } from "../shared/EmptyState.tsx";
import { MapPinButton } from "../shared/MapPinButton.tsx";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type FormMode = { kind: "list" } | { kind: "create" } | { kind: "edit"; vehicle: Vehicle };

const NUMERIC_FIELDS = ["capacity_kg", "start_location.lat", "start_location.lng"];

interface VehicleTabProps {
  vehicles: Vehicle[];
  rev: number;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function VehicleTab({ vehicles, rev }: VehicleTabProps) {
  const [mode, setMode] = useState<FormMode>({ kind: "list" });

  const createMutation = useCreateVehicle();
  const updateMutation = useUpdateVehicle();
  const deleteMutation = useDeleteVehicle();

  const handleDelete = (id: string) => {
    if (!confirm(`Delete vehicle "${id}"?`)) return;
    deleteMutation.mutate({ id, baseRev: rev });
  };

  /* ---- List view ---- */
  if (mode.kind === "list") {
    return (
      <div className="entity-tab">
        <div className="entity-tab__toolbar">
          <button
            className="btn btn-primary"
            onClick={() => setMode({ kind: "create" })}
          >
            + Add Vehicle
          </button>
        </div>

        {vehicles.length === 0 ? (
          <EmptyState
            title="No vehicles"
            description="Create your first vehicle to start dispatching"
          />
        ) : (
          <div className="entity-list">
            {vehicles.map((v) => (
              <div key={v.id} className="entity-row">
                <div className="entity-row__info">
                  <span className="entity-row__name">{v.name}</span>
                  <span className="entity-row__meta">
                    {v.id} &middot; {v.capacity_kg} kg &middot; ({v.start_location.lat.toFixed(3)}, {v.start_location.lng.toFixed(3)})
                  </span>
                </div>
                <div className="entity-row__actions">
                  <button
                    className="btn-icon"
                    title="Edit"
                    onClick={() => setMode({ kind: "edit", vehicle: v })}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.85 0 114 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                  </button>
                  <button
                    className="btn-icon"
                    title="Delete"
                    onClick={() => handleDelete(v.id)}
                    disabled={deleteMutation.isPending}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  /* ---- Form view (create / edit) ---- */
  const isEdit = mode.kind === "edit";
  const defaults: Record<string, unknown> = isEdit
    ? {
        id: mode.vehicle.id,
        name: mode.vehicle.name,
        capacity_kg: mode.vehicle.capacity_kg,
        start_location: {
          lat: mode.vehicle.start_location.lat,
          lng: mode.vehicle.start_location.lng,
        },
      }
    : {
        id: "",
        name: "",
        capacity_kg: "",
        start_location: { lat: "", lng: "" },
      };

  return (
    <VehicleForm
      key={isEdit ? mode.vehicle.id : "__create__"}
      defaults={defaults}
      isEdit={isEdit}
      isPending={createMutation.isPending || updateMutation.isPending}
      onSubmit={(data) => {
        if (isEdit) {
          const { id: _id, ...body } = data;
          updateMutation.mutate(
            { id: mode.vehicle.id, body },
            { onSuccess: () => setMode({ kind: "list" }) },
          );
        } else {
          createMutation.mutate(data, {
            onSuccess: () => setMode({ kind: "list" }),
          });
        }
      }}
      onCancel={() => setMode({ kind: "list" })}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  VehicleForm (SRP: form rendering + validation only)                */
/* ------------------------------------------------------------------ */

interface VehicleFormProps {
  defaults: Record<string, unknown>;
  isEdit: boolean;
  isPending: boolean;
  onSubmit: (data: Vehicle) => void;
  onCancel: () => void;
}

function VehicleForm({ defaults, isEdit, isPending, onSubmit, onCancel }: VehicleFormProps) {
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(VehicleSchema, NUMERIC_FIELDS),
    defaultValues: defaults,
  });

  const startPicker = useUIStore((s) => s.startLocationPicker);

  const handlePickLocation = useCallback(() => {
    startPicker((lat, lng) => {
      setValue("start_location.lat", lat as never, { shouldValidate: true });
      setValue("start_location.lng", lng as never, { shouldValidate: true });
    });
  }, [startPicker, setValue]);

  const submit = handleSubmit((raw) => {
    const coerced = coerceNumbers(raw as Record<string, unknown>, NUMERIC_FIELDS);
    const result = VehicleSchema.safeParse(coerced);
    if (result.success) {
      onSubmit(result.data);
    }
  });

  const fieldError = (path: string): string | undefined => {
    const parts = path.split(".");
    let obj: unknown = errors;
    for (const part of parts) {
      if (obj && typeof obj === "object" && part in obj) {
        obj = (obj as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return (obj as { message?: string } | undefined)?.message;
  };

  return (
    <form className="entity-form" onSubmit={submit}>
      <h4 className="entity-form__title">
        {isEdit ? "Edit Vehicle" : "New Vehicle"}
      </h4>

      <FormField label="ID" name="id" required error={fieldError("id")}>
        <input
          id="id"
          className="form-input"
          {...register("id")}
          disabled={isEdit}
          placeholder="e.g. v_001"
        />
      </FormField>

      <FormField label="Name" name="name" required error={fieldError("name")}>
        <input
          id="name"
          className="form-input"
          {...register("name")}
          placeholder="e.g. Truck Alpha"
        />
      </FormField>

      <FormField label="Capacity (kg)" name="capacity_kg" required error={fieldError("capacity_kg")}>
        <input
          id="capacity_kg"
          className="form-input"
          type="number"
          step="any"
          {...register("capacity_kg")}
          placeholder="e.g. 1000"
        />
      </FormField>

      <div className="form-row form-row--with-action">
        <FormField label="Start Lat" name="start_location.lat" required error={fieldError("start_location.lat")}>
          <input
            id="start_location.lat"
            className="form-input"
            type="number"
            step="any"
            {...register("start_location.lat")}
            placeholder="e.g. 52.520"
          />
        </FormField>
        <FormField label="Start Lng" name="start_location.lng" required error={fieldError("start_location.lng")}>
          <input
            id="start_location.lng"
            className="form-input"
            type="number"
            step="any"
            {...register("start_location.lng")}
            placeholder="e.g. 13.405"
          />
        </FormField>
        <MapPinButton onClick={handlePickLocation} title="Pick start location on map" />
      </div>

      <div className="entity-form__actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={isPending}>
          {isPending ? "Saving..." : isEdit ? "Update" : "Create"}
        </button>
      </div>
    </form>
  );
}
