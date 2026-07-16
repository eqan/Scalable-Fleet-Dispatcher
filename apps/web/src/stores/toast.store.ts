/**
 * Toast notification store (Zustand).
 *
 * Design:
 *   - Centralized notification state decoupled from UI rendering.
 *   - Any hook/mutation can call `addToast()` without importing React.
 *   - Toasts auto-dismiss via Radix Toast's built-in duration.
 *   - DRY: single `addToast` for success, error, info, and warning.
 *
 * Architecture decision -- why Zustand over React context:
 *   Mutations run in hooks that may not have convenient access
 *   to a context provider. Zustand's global store lets any
 *   module push a toast without prop-drilling or context coupling.
 */

import { create } from "zustand";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type ToastVariant = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastState {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */

let nextId = 0;

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],

  addToast: (toast) => {
    const id = `toast-${++nextId}`;
    set((s) => ({
      toasts: [...s.toasts, { ...toast, id }],
    }));
  },

  dismissToast: (id) =>
    set((s) => ({
      toasts: s.toasts.filter((t) => t.id !== id),
    })),
}));
