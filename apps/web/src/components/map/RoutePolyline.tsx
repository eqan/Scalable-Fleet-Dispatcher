/**
 * RoutePolyline -- colored line connecting depot → stops for a vehicle.
 *
 * - Draws a polyline from the depot through each stop in order
 * - Uses vehicle-specific color for easy visual identification
 * - Dashed pattern with directional appearance (wider at start)
 * - Tooltip showing vehicle name on hover
 */

import { Polyline, Tooltip } from "react-leaflet";
import type { RouteGeometry } from "../../lib/map-utils.tsx";

interface RoutePolylineProps {
  route: RouteGeometry;
  vehicleName: string;
}

export function RoutePolyline({ route, vehicleName }: RoutePolylineProps) {
  if (route.points.length < 2) return null;

  return (
    <Polyline
      positions={route.points}
      pathOptions={{
        color: route.color,
        weight: 3,
        opacity: 0.75,
        dashArray: "8 6",
        lineCap: "round",
        lineJoin: "round",
      }}
    >
      <Tooltip sticky>{vehicleName} route</Tooltip>
    </Polyline>
  );
}
