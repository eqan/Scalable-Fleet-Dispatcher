/**
 * OrderMarker -- Leaflet marker for a single order on the map.
 *
 * - Color-coded by assigned vehicle (gray if unassigned)
 * - Shows stop number for assigned orders
 * - Popup with order details (ID, weight, service time, vehicle)
 * - Click-to-select: highlights order on dispatch board
 * - Draggable: drag near a vehicle depot to reassign the order
 */

import { useRef, useCallback } from "react";
import { Marker, Popup } from "react-leaflet";
import L from "leaflet";
import type { Order } from "@repo/shared";
import { orderIcon, OrderPopupContent } from "../../lib/map-utils.tsx";

interface OrderMarkerProps {
  order: Order;
  color: string;
  vehicleName?: string;
  stopNumber?: number;
  isSelected: boolean;
  onSelect: (orderId: string) => void;
  /** Called when the marker is dragged and released with the drop location. */
  onDragEnd?: (order: Order, latlng: L.LatLng) => void;
}

export function OrderMarker({
  order,
  color,
  vehicleName,
  stopNumber,
  isSelected,
  onSelect,
  onDragEnd,
}: OrderMarkerProps) {
  const markerRef = useRef<L.Marker | null>(null);

  const handleDragEnd = useCallback(() => {
    const marker = markerRef.current;
    if (!marker || !onDragEnd) return;

    const newPos = marker.getLatLng();

    // Snap marker back to original position (we're reassigning, not relocating)
    marker.setLatLng([order.location.lat, order.location.lng]);

    onDragEnd(order, newPos);
  }, [order, onDragEnd]);

  return (
    <Marker
      ref={markerRef}
      position={[order.location.lat, order.location.lng]}
      icon={orderIcon(color, stopNumber, isSelected)}
      draggable={!!onDragEnd}
      eventHandlers={{
        click: () => onSelect(order.id),
        dragend: handleDragEnd,
      }}
    >
      <Popup>
        <OrderPopupContent
          order={order}
          vehicleName={vehicleName}
          stopNumber={stopNumber}
        />
      </Popup>
    </Marker>
  );
}
