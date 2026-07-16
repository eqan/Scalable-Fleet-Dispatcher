/**
 * MapLegend -- interactive legend overlay on the map.
 *
 * Features:
 *   - Shows each vehicle with its color swatch and name
 *   - Click to toggle route visibility per vehicle
 *   - Shows unassigned indicator
 *   - Collapsible for mobile/small screens
 */

import type { Vehicle } from "@repo/shared";

interface MapLegendProps {
  vehicles: Vehicle[];
  colorMap: Record<string, string>;
  hiddenVehicles: Set<string>;
  onToggleVehicle: (vehicleId: string) => void;
  unassignedCount: number;
}

export function MapLegend({
  vehicles,
  colorMap,
  hiddenVehicles,
  onToggleVehicle,
  unassignedCount,
}: MapLegendProps) {
  return (
    <div className="map-legend">
      <div className="map-legend__title">Routes</div>
      {vehicles.map((v) => {
        const isHidden = hiddenVehicles.has(v.id);
        const color = colorMap[v.id] ?? "#6b7280";
        return (
          <button
            key={v.id}
            className={`map-legend__item ${isHidden ? "map-legend__item--hidden" : ""}`}
            onClick={() => onToggleVehicle(v.id)}
            title={isHidden ? `Show ${v.name} route` : `Hide ${v.name} route`}
          >
            <span
              className="map-legend__swatch"
              style={{ background: isHidden ? "transparent" : color, borderColor: color }}
            />
            <span className="map-legend__label">{v.name}</span>
          </button>
        );
      })}
      {unassignedCount > 0 && (
        <div className="map-legend__item map-legend__item--static">
          <span
            className="map-legend__swatch"
            style={{ background: "#6b7280", borderColor: "#6b7280" }}
          />
          <span className="map-legend__label">
            Unassigned ({unassignedCount})
          </span>
        </div>
      )}
    </div>
  );
}
