/**
 * MasterDataDrawer -- custom slide-in side panel (no Radix Dialog).
 *
 * Why not Radix Dialog?
 *   Radix Dialog sets `aria-hidden` on all sibling DOM nodes and traps
 *   focus inside the dialog. This blocks interaction with the Leaflet
 *   map (which lives in a sibling subtree). We need the form to stay
 *   mounted while the drawer is visually hidden during location picker
 *   mode so that the `setValue` callback remains valid. A simple div-
 *   based drawer gives us full control over mount/visibility without
 *   any modal side-effects on the rest of the page.
 *
 * Architecture:
 *   - Mount when `isOpen || isPicking` (keeps form alive during pick)
 *   - Visible only when `isOpen && !isPicking`
 *   - Escape key closes the drawer (when visible)
 *   - Overlay click closes the drawer (when visible)
 *   - Tab state is local (scoped to drawer lifetime)
 */

import { useState, useEffect, useCallback } from "react";
import type { StateResponse } from "@repo/shared";
import { useUIStore } from "../../stores/ui.store.ts";
import { VehicleTab } from "./VehicleTab.tsx";
import { OrderTab } from "./OrderTab.tsx";

type Tab = "vehicles" | "orders";

interface MasterDataDrawerProps {
  state: StateResponse;
}

export function MasterDataDrawer({ state }: MasterDataDrawerProps) {
  const isOpen = useUIStore((s) => s.isDrawerOpen);
  const toggleDrawer = useUIStore((s) => s.toggleDrawer);
  const isPicking = useUIStore((s) => s.locationPickerCallback) !== null;
  const [activeTab, setActiveTab] = useState<Tab>("vehicles");

  // Mount when drawer is open OR a location pick is in progress
  // (keeps the form in the DOM so setValue callback stays valid)
  const shouldMount = isOpen || isPicking;

  // Visible only when open AND not in picker mode
  const isVisible = isOpen && !isPicking;

  /* ---- Escape key handler ---- */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && isVisible) toggleDrawer();
    },
    [isVisible, toggleDrawer],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (!shouldMount) return null;

  return (
    <>
      {/* ---- Overlay (only when visible) ---- */}
      {isVisible && (
        <div className="drawer-overlay" onClick={toggleDrawer} />
      )}

      {/* ---- Drawer panel ---- */}
      <div
        className={`drawer ${isVisible ? "" : "drawer--hidden"}`}
        role="dialog"
        aria-label="Master Data"
      >
        {/* ---- Header ---- */}
        <div className="drawer__header">
          <h2 className="drawer__title">Master Data</h2>
          {isVisible && (
            <button
              className="btn-icon"
              aria-label="Close drawer"
              onClick={toggleDrawer}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6L6 18" />
                <path d="M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* ---- Tabs ---- */}
        <div className="drawer__tabs">
          <button
            className={`drawer__tab ${activeTab === "vehicles" ? "drawer__tab--active" : ""}`}
            onClick={() => setActiveTab("vehicles")}
          >
            Vehicles ({state.vehicles.length})
          </button>
          <button
            className={`drawer__tab ${activeTab === "orders" ? "drawer__tab--active" : ""}`}
            onClick={() => setActiveTab("orders")}
          >
            Orders ({state.orders.length})
          </button>
        </div>

        {/* ---- Tab content ---- */}
        <div className="drawer__body">
          {activeTab === "vehicles" && (
            <VehicleTab vehicles={state.vehicles} rev={state.rev} />
          )}
          {activeTab === "orders" && (
            <OrderTab orders={state.orders} rev={state.rev} />
          )}
        </div>
      </div>
    </>
  );
}
