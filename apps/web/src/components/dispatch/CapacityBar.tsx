/**
 * CapacityBar -- visual progress indicator for vehicle load.
 *
 * Color-coded:
 *   - Green (< 70%): healthy load
 *   - Warning (70-90%): getting full
 *   - Danger (> 90%): at or over capacity
 *
 * Pure presentational component -- receives computed values as props.
 */

interface CapacityBarProps {
  /** Current load in kg. */
  currentKg: number;
  /** Maximum capacity in kg. */
  capacityKg: number;
}

export function CapacityBar({ currentKg, capacityKg }: CapacityBarProps) {
  const ratio = capacityKg > 0 ? currentKg / capacityKg : 0;
  const percent = Math.min(ratio * 100, 100);
  const overloaded = ratio > 1;

  const variant =
    ratio > 0.9 ? "danger" : ratio > 0.7 ? "warning" : "success";

  return (
    <div className="capacity-bar">
      <div className="capacity-bar__track">
        <div
          className={`capacity-bar__fill capacity-bar__fill--${variant}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className={`capacity-bar__label ${overloaded ? "capacity-bar__label--danger" : ""}`}>
        {currentKg.toLocaleString()} / {capacityKg.toLocaleString()} kg
      </span>
    </div>
  );
}
