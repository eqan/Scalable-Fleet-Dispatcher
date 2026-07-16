/**
 * OrderTab -- order list + create/edit form inside the Master Data drawer.
 *
 * Mirrors VehicleTab's UX pattern:
 *   - Default: shows list of orders with Edit/Delete actions
 *   - "Add Order" or "Edit" → shows form (replaces list)
 *   - "Cancel" or successful submit → returns to list
 *
 * Validation: Zod OrderSchema via our custom zodResolver (DRY).
 * Mutations: useCrudMutations hooks (DRY factory pattern).
 */

import { useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { OrderSchema, type Order } from "@repo/shared";
import { zodResolver, coerceNumbers } from "../../lib/form.ts";
import { useCreateOrder, useUpdateOrder, useDeleteOrder } from "../../hooks/useCrudMutations.ts";
import { useUIStore } from "../../stores/ui.store.ts";
import { FormField } from "../shared/FormField.tsx";
import { EmptyState } from "../shared/EmptyState.tsx";
import { MapPinButton } from "../shared/MapPinButton.tsx";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type FormMode = { kind: "list" } | { kind: "create" } | { kind: "edit"; order: Order };

const NUMERIC_FIELDS = ["weight_kg", "service_time_min", "location.lat", "location.lng"];

interface OrderTabProps {
  orders: Order[];
  rev: number;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function OrderTab({ orders, rev }: OrderTabProps) {
  const [mode, setMode] = useState<FormMode>({ kind: "list" });

  const createMutation = useCreateOrder();
  const updateMutation = useUpdateOrder();
  const deleteMutation = useDeleteOrder();

  const handleDelete = (id: string) => {
    if (!confirm(`Delete order "${id}"?`)) return;
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
            + Add Order
          </button>
        </div>

        {orders.length === 0 ? (
          <EmptyState
            title="No orders"
            description="Create your first order to populate the dispatch board"
          />
        ) : (
          <div className="entity-list">
            {orders.map((o) => (
              <div key={o.id} className="entity-row">
                <div className="entity-row__info">
                  <span className="entity-row__name">{o.id}</span>
                  <span className="entity-row__meta">
                    {o.weight_kg} kg &middot; {o.service_time_min} min &middot; ({o.location.lat.toFixed(3)}, {o.location.lng.toFixed(3)})
                  </span>
                </div>
                <div className="entity-row__actions">
                  <button
                    className="btn-icon"
                    title="Edit"
                    onClick={() => setMode({ kind: "edit", order: o })}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.85 0 114 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                  </button>
                  <button
                    className="btn-icon"
                    title="Delete"
                    onClick={() => handleDelete(o.id)}
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
        id: mode.order.id,
        weight_kg: mode.order.weight_kg,
        service_time_min: mode.order.service_time_min,
        location: {
          lat: mode.order.location.lat,
          lng: mode.order.location.lng,
        },
      }
    : {
        id: "",
        weight_kg: "",
        service_time_min: "",
        location: { lat: "", lng: "" },
      };

  return (
    <OrderForm
      key={isEdit ? mode.order.id : "__create__"}
      defaults={defaults}
      isEdit={isEdit}
      isPending={createMutation.isPending || updateMutation.isPending}
      onSubmit={(data) => {
        if (isEdit) {
          const { id: _id, ...body } = data;
          updateMutation.mutate(
            { id: mode.order.id, body },
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
/*  OrderForm (SRP: form rendering + validation only)                  */
/* ------------------------------------------------------------------ */

interface OrderFormProps {
  defaults: Record<string, unknown>;
  isEdit: boolean;
  isPending: boolean;
  onSubmit: (data: Order) => void;
  onCancel: () => void;
}

function OrderForm({ defaults, isEdit, isPending, onSubmit, onCancel }: OrderFormProps) {
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(OrderSchema, NUMERIC_FIELDS),
    defaultValues: defaults,
  });

  const startPicker = useUIStore((s) => s.startLocationPicker);

  const handlePickLocation = useCallback(() => {
    startPicker((lat, lng) => {
      setValue("location.lat", lat as never, { shouldValidate: true });
      setValue("location.lng", lng as never, { shouldValidate: true });
    });
  }, [startPicker, setValue]);

  const submit = handleSubmit((raw) => {
    const coerced = coerceNumbers(raw as Record<string, unknown>, NUMERIC_FIELDS);
    const result = OrderSchema.safeParse(coerced);
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
        {isEdit ? "Edit Order" : "New Order"}
      </h4>

      <FormField label="ID" name="id" required error={fieldError("id")}>
        <input
          id="id"
          className="form-input"
          {...register("id")}
          disabled={isEdit}
          placeholder="e.g. o_101"
        />
      </FormField>

      <FormField label="Weight (kg)" name="weight_kg" required error={fieldError("weight_kg")}>
        <input
          id="weight_kg"
          className="form-input"
          type="number"
          step="any"
          {...register("weight_kg")}
          placeholder="e.g. 150"
        />
      </FormField>

      <FormField label="Service Time (min)" name="service_time_min" required error={fieldError("service_time_min")}>
        <input
          id="service_time_min"
          className="form-input"
          type="number"
          step="any"
          {...register("service_time_min")}
          placeholder="e.g. 15"
        />
      </FormField>

      <div className="form-row form-row--with-action">
        <FormField label="Lat" name="location.lat" required error={fieldError("location.lat")}>
          <input
            id="location.lat"
            className="form-input"
            type="number"
            step="any"
            {...register("location.lat")}
            placeholder="e.g. 52.520"
          />
        </FormField>
        <FormField label="Lng" name="location.lng" required error={fieldError("location.lng")}>
          <input
            id="location.lng"
            className="form-input"
            type="number"
            step="any"
            {...register("location.lng")}
            placeholder="e.g. 13.405"
          />
        </FormField>
        <MapPinButton onClick={handlePickLocation} title="Pick location on map" />
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
