/**
 * useKeyboardShortcuts -- centralized keyboard shortcut handler.
 *
 * Consolidates all keyboard shortcuts in one place (DRY).
 * Previously Ctrl+S was handled inline in App.tsx; this hook
 * owns all shortcuts and their side effects.
 *
 * Shortcuts:
 *   - Ctrl+S / Cmd+S → Save plan
 *   - Ctrl+M / Cmd+M → Toggle Master Data drawer
 *   - Escape → Close drawer / deselect order
 *   - ? (Shift+/) → Toggle shortcut help overlay
 *
 * Design:
 *   - Single event listener (not one per shortcut)
 *   - Callbacks passed in to avoid coupling to specific stores
 */

import { useEffect, useCallback } from "react";

export interface ShortcutCallbacks {
  onSave: () => void;
  onToggleDrawer: () => void;
  onCloseDrawer: () => void;
  onDeselectOrder: () => void;
  onToggleShortcutHelp: () => void;
}

export function useKeyboardShortcuts(callbacks: ShortcutCallbacks) {
  const handler = useCallback(
    (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      const target = e.target as HTMLElement;

      // Don't fire shortcuts when typing in inputs
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) {
        // Exception: Escape should still work inside inputs
        if (e.key !== "Escape") return;
      }

      // Ctrl+S / Cmd+S → Save
      if (meta && e.key === "s") {
        e.preventDefault();
        callbacks.onSave();
        return;
      }

      // Ctrl+M / Cmd+M → Toggle drawer
      if (meta && e.key === "m") {
        e.preventDefault();
        callbacks.onToggleDrawer();
        return;
      }

      // Escape → Close drawer or deselect
      if (e.key === "Escape") {
        callbacks.onCloseDrawer();
        callbacks.onDeselectOrder();
        return;
      }

      // ? (Shift+/) → Toggle help overlay
      if (e.key === "?" && e.shiftKey) {
        e.preventDefault();
        callbacks.onToggleShortcutHelp();
        return;
      }
    },
    [callbacks],
  );

  useEffect(() => {
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handler]);
}

/* ------------------------------------------------------------------ */
/*  Shortcut definitions for the help overlay                          */
/* ------------------------------------------------------------------ */

export interface ShortcutDef {
  keys: string[];
  label: string;
}

export const SHORTCUTS: ShortcutDef[] = [
  { keys: ["Ctrl", "S"], label: "Save plan to database" },
  { keys: ["Ctrl", "M"], label: "Toggle Master Data drawer" },
  { keys: ["Esc"], label: "Close drawer / deselect order" },
  { keys: ["?"], label: "Toggle this help panel" },
];
