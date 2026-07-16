/**
 * Root application component.
 *
 * Thin shell -- delegates:
 *   - Data fetching → useHotState (TanStack Query)
 *   - State derivation → selectors (pure functions)
 *   - Board rendering → DispatchBoard (DndContext + columns)
 *   - Map visualization → MapPane (Leaflet + route layers)
 *   - CRUD management → MasterDataDrawer (custom slide-in drawer)
 *   - Save persistence → useSaveMutation (POST /api/save)
 *   - Notifications → ToastProvider (Radix Toast + Zustand)
 *   - Error recovery → ErrorBoundary (class component)
 *   - Keyboard shortcuts → useKeyboardShortcuts (centralized)
 *   - Connection status → Zustand connection store
 */

import { useState, useCallback, useMemo } from "react";
import { useHotState } from "./hooks/useHotState.ts";
import { useSaveMutation } from "./hooks/useSaveMutation.ts";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts.ts";
import { stateSummary } from "./lib/selectors.ts";
import { useConnectionStore } from "./stores/connection.store.ts";
import { useUIStore } from "./stores/ui.store.ts";
import { StatCard } from "./components/shared/StatCard.tsx";
import { SkeletonBoard } from "./components/shared/Skeleton.tsx";
import { SplitLayout } from "./components/shared/SplitLayout.tsx";
import { ShortcutHelp } from "./components/shared/ShortcutHelp.tsx";
import { DispatchBoard } from "./components/dispatch/DispatchBoard.tsx";
import { MapPane } from "./components/map/MapPane.tsx";
import { MasterDataDrawer } from "./components/master-data/MasterDataDrawer.tsx";

export function App() {
  const isConnected = useConnectionStore((s) => s.isConnected);
  const isDirty = useUIStore((s) => s.isDirty);
  const toggleDrawer = useUIStore((s) => s.toggleDrawer);
  const isDrawerOpen = useUIStore((s) => s.isDrawerOpen);
  const selectOrder = useUIStore((s) => s.selectOrder);
  const { data, isLoading, error } = useHotState();
  const saveMutation = useSaveMutation();

  const summary = data ? stateSummary(data) : null;

  /* ---- Shortcut help overlay ---- */
  const [showShortcuts, setShowShortcuts] = useState(false);

  /* ---- Save handler (shared by button + keyboard shortcut) ---- */
  const handleSave = useCallback(() => {
    if (!isDirty || saveMutation.isPending) return;
    saveMutation.mutate();
  }, [isDirty, saveMutation]);

  /* ---- Close drawer handler ---- */
  const handleCloseDrawer = useCallback(() => {
    if (isDrawerOpen) toggleDrawer();
  }, [isDrawerOpen, toggleDrawer]);

  /* ---- Centralized keyboard shortcuts ---- */
  const shortcutCallbacks = useMemo(
    () => ({
      onSave: handleSave,
      onToggleDrawer: toggleDrawer,
      onCloseDrawer: handleCloseDrawer,
      onDeselectOrder: () => selectOrder(null),
      onToggleShortcutHelp: () => setShowShortcuts((v) => !v),
    }),
    [handleSave, toggleDrawer, handleCloseDrawer, selectOrder],
  );
  useKeyboardShortcuts(shortcutCallbacks);

  /* ---- Save button label ---- */
  const saveLabel = saveMutation.isPending
    ? "Saving..."
    : saveMutation.isSuccess && !isDirty
      ? "Saved"
      : "Save Plan";

  return (
    <div className="app">
      {/* ---- Header ---- */}
      <header className="app-header">
        <h1>Mission Control — Dispatch Dashboard</h1>

        <div className="header-center">
          {summary && (
            <div className="dashboard-stats">
              <StatCard label="Vehicles" value={summary.vehicleCount} />
              <StatCard label="Orders" value={summary.orderCount} />
              <StatCard label="Assigned" value={summary.assignedCount} variant="success" />
              <StatCard label="Unassigned" value={summary.unassignedCount} variant="warning" />
              <StatCard label="Rev" value={summary.rev} variant="muted" />
            </div>
          )}
        </div>

        <div className="header-right">
          <button
            className="btn"
            onClick={toggleDrawer}
            title="Manage master data (Ctrl+M)"
          >
            Manage
          </button>

          {/* ---- Save button ---- */}
          <button
            className={`btn ${
              saveMutation.isSuccess && !isDirty
                ? "btn-success"
                : isDirty
                  ? "btn-save--dirty"
                  : ""
            }`}
            onClick={handleSave}
            disabled={!isDirty || saveMutation.isPending}
            title="Save plan to database (Ctrl+S)"
          >
            {saveMutation.isPending && <div className="spinner spinner--sm" />}
            {saveLabel}
          </button>

          {isDirty && <span className="dirty-badge">Unsaved</span>}

          <div className="connection-status">
            <span
              className={`status-dot ${isConnected ? "connected" : "disconnected"}`}
            />
            {isConnected ? "Live" : "Offline"}
          </div>

          {/* ---- Shortcut hint button ---- */}
          <button
            className="btn-icon"
            onClick={() => setShowShortcuts((v) => !v)}
            title="Keyboard shortcuts (?)"
            aria-label="Show keyboard shortcuts"
          >
            ?
          </button>
        </div>
      </header>

      {/* ---- Main content: split layout (board + map) ---- */}
      <main className="app-main">
        {isLoading && (
          <SplitLayout
            left={<SkeletonBoard />}
            right={
              <div className="skeleton-map">
                <div className="skeleton skeleton--map-tile" />
              </div>
            }
          />
        )}

        {error && (
          <div className="state-error">
            <p className="error">
              Failed to load state: {error.message}
            </p>
            <button
              className="btn btn-primary"
              onClick={() => window.location.reload()}
            >
              Retry
            </button>
          </div>
        )}

        {data && (
          <SplitLayout
            left={<DispatchBoard state={data} />}
            right={<MapPane state={data} />}
          />
        )}
      </main>

      {/* ---- Drawer (portal rendered by Radix) ---- */}
      {data && <MasterDataDrawer state={data} />}

      {/* ---- Keyboard shortcut help overlay ---- */}
      <ShortcutHelp
        isOpen={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />
    </div>
  );
}
