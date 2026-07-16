/**
 * VehicleDepotMarker -- Leaflet marker for a vehicle's start/depot location.
 *
 * - Diamond shape (visually distinct from circular order markers)
 * - Color matches the vehicle's route color
 * - Popup with vehicle details (name, capacity, location)
 */

import { Marker, Popup } from "react-leaflet";
import type { Vehicle } from "@repo/shared";
import { depotIcon, DepotPopupContent } from "../../lib/map-utils.tsx";

interface VehicleDepotMarkerProps {
  vehicle: Vehicle;
  color: string;
}

export function VehicleDepotMarker({ vehicle, color }: VehicleDepotMarkerProps) {
  return (
    <Marker
      position={[vehicle.start_location.lat, vehicle.start_location.lng]}
      icon={depotIcon(color)}
    >
      <Popup>
        <DepotPopupContent vehicle={vehicle} />
      </Popup>
    </Marker>
  );
}

