/**
 * ShortcutHelp -- floating overlay showing keyboard shortcut hints.
 *
 * Toggled by pressing "?" (Shift+/).
 * Shows all registered shortcuts with their key combos.
 *
 * Design:
 *   - Reads shortcut definitions from the centralized SHORTCUTS array
 *   - Rendered as a fixed overlay (doesn't affect layout)
 *   - Click outside or press Escape to close
 */

import { SHORTCUTS, type ShortcutDef } from "../../hooks/useKeyboardShortcuts.ts";

interface ShortcutHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ShortcutHelp({ isOpen, onClose }: ShortcutHelpProps) {
  if (!isOpen) return null;

  return (
    <div className="shortcut-overlay" onClick={onClose}>
      <div
        className="shortcut-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shortcut-panel__header">
          <h3 className="shortcut-panel__title">Keyboard Shortcuts</h3>
          <button className="toast__close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>
        <div className="shortcut-panel__list">
          {SHORTCUTS.map((shortcut: ShortcutDef) => (
            <ShortcutRow key={shortcut.label} shortcut={shortcut} />
          ))}
        </div>
        <div className="shortcut-panel__footer">
          Press <kbd className="kbd">?</kbd> to toggle this panel
        </div>
      </div>
    </div>
  );
}

function ShortcutRow({ shortcut }: { shortcut: ShortcutDef }) {
  return (
    <div className="shortcut-row">
      <div className="shortcut-row__keys">
        {shortcut.keys.map((key, i) => (
          <span key={i}>
            {i > 0 && <span className="shortcut-row__plus">+</span>}
            <kbd className="kbd">{key}</kbd>
          </span>
        ))}
      </div>
      <span className="shortcut-row__label">{shortcut.label}</span>
    </div>
  );
}
