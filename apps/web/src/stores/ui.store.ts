import { create } from "zustand";

/** Callback shape for map location picker. */
export type LocationPickerCallback = (lat: number, lng: number) => void;

/**
 * Zustand store for UI-only state (selection, filters, drawer, drag state).
 * Keeps server state (TanStack Query) and UI state cleanly separated.
 */
interface UIState {
  /** Currently selected order ID (for highlighting in table + map). */
  selectedOrderId: string | null;
  selectOrder: (id: string | null) => void;

  /** Whether the Master Data drawer is open. */
  isDrawerOpen: boolean;
  toggleDrawer: () => void;

  /** Which vehicle is currently being optimized (spinner state). */
  optimizingVehicleIds: Set<string>;
  setOptimizing: (vehicleId: string, optimizing: boolean) => void;

  /** Whether the unassigned panel is collapsed. */
  isUnassignedCollapsed: boolean;
  toggleUnassignedPanel: () => void;

  /**
   * Location picker -- allows forms to request a click-on-map coordinate.
   * Non-null callback = picker is active; map shows crosshair + banner.
   */
  locationPickerCallback: LocationPickerCallback | null;
  startLocationPicker: (cb: LocationPickerCallback) => void;
  stopLocationPicker: () => void;

  /** Whether there are unsaved changes ("dirty" indicator). */
  isDirty: boolean;
  markDirty: () => void;
  clearDirty: () => void;
}

export const useUIStore = create<UIState>()((set) => ({
  selectedOrderId: null,
  selectOrder: (id) => set({ selectedOrderId: id }),

  isDrawerOpen: false,
  toggleDrawer: () => set((s) => ({ isDrawerOpen: !s.isDrawerOpen })),

  optimizingVehicleIds: new Set(),
  setOptimizing: (vehicleId, optimizing) =>
    set((s) => {
      const next = new Set(s.optimizingVehicleIds);
      if (optimizing) next.add(vehicleId);
      else next.delete(vehicleId);
      return { optimizingVehicleIds: next };
    }),

  isUnassignedCollapsed: false,
  toggleUnassignedPanel: () =>
    set((s) => ({ isUnassignedCollapsed: !s.isUnassignedCollapsed })),

  locationPickerCallback: null,
  startLocationPicker: (cb) =>
    set({ locationPickerCallback: cb, isDrawerOpen: false }),
  stopLocationPicker: () =>
    set({ locationPickerCallback: null, isDrawerOpen: true }),

  isDirty: false,
  markDirty: () => set({ isDirty: true }),
  clearDirty: () => set({ isDirty: false }),
}));
