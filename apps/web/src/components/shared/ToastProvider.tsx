/**
 * ToastProvider -- Radix Toast viewport + rendered toasts.
 *
 * Renders a stack of toast notifications in the bottom-right corner.
 * Connects to the Zustand toast store for centralized notification management.
 *
 * Features:
 *   - Variant-colored styling (success, error, warning, info)
 *   - Auto-dismiss with configurable duration per variant
 *   - Swipe-to-dismiss on touch devices (Radix built-in)
 *   - Accessible: ARIA live region, keyboard navigable
 *
 * DRY: one render point for all toasts application-wide.
 */

import * as RadixToast from "@radix-ui/react-toast";
import { useToastStore, type Toast } from "../../stores/toast.store.ts";

/* ------------------------------------------------------------------ */
/*  Duration per variant (ms)                                          */
/* ------------------------------------------------------------------ */

const DURATION: Record<string, number> = {
  success: 3000,
  info: 4000,
  warning: 5000,
  error: 6000,
};

/* ------------------------------------------------------------------ */
/*  Single Toast Item                                                  */
/* ------------------------------------------------------------------ */

function ToastItem({ toast }: { toast: Toast }) {
  const dismissToast = useToastStore((s) => s.dismissToast);

  return (
    <RadixToast.Root
      className={`toast toast--${toast.variant}`}
      duration={DURATION[toast.variant] ?? 4000}
      onOpenChange={(open) => {
        if (!open) dismissToast(toast.id);
      }}
    >
      <div className="toast__icon">{variantIcon(toast.variant)}</div>
      <div className="toast__content">
        <RadixToast.Title className="toast__title">
          {toast.title}
        </RadixToast.Title>
        {toast.description && (
          <RadixToast.Description className="toast__description">
            {toast.description}
          </RadixToast.Description>
        )}
      </div>
      <RadixToast.Close className="toast__close" aria-label="Dismiss">
        &times;
      </RadixToast.Close>
    </RadixToast.Root>
  );
}

/* ------------------------------------------------------------------ */
/*  Variant icons (inline SVG, no deps)                                */
/* ------------------------------------------------------------------ */

function variantIcon(variant: string): string {
  switch (variant) {
    case "success":
      return "\u2713"; // checkmark
    case "error":
      return "\u2717"; // cross
    case "warning":
      return "\u26A0"; // warning triangle
    case "info":
    default:
      return "\u2139"; // info circle
  }
}

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const toasts = useToastStore((s) => s.toasts);

  return (
    <RadixToast.Provider swipeDirection="right">
      {children}
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
      <RadixToast.Viewport className="toast-viewport" />
    </RadixToast.Provider>
  );
}
