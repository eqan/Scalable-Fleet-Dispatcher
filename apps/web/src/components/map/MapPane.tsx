/**
 * MapPane -- Main Leaflet map container integrating all layers.
 *
 * Features:
 *   - OpenStreetMap tile layer (free, no API key)
 *   - Order markers (color-coded by vehicle, numbered by stop sequence)
 *   - Vehicle depot markers (diamond shape)
 *   - Route polylines (colored, dashed)
 *   - Interactive legend with per-vehicle route toggling
 *   - Auto-fit bounds to show all data points
 *   - Selection sync: clicking an order highlights it on dispatch board
 *   - Leaflet icon fix for Vite/bundler compatibility
 *
 * Architecture:
 *   - Props-driven: receives StateResponse, computes all derived data.
 *   - Pure derivations in map-utils (testable, DRY).
 *   - Local state only for legend toggle (hiddenVehicles).
 */

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import type { StateResponse, Order } from "@repo/shared";
import { useUIStore } from "../../stores/ui.store.ts";
import type { LocationPickerCallback } from "../../stores/ui.store.ts";
import {
  buildColorMap,
  buildOrderVehicleMap,
  buildStopNumberMap,
  buildRouteGeometries,
  computeBounds,
  findNearestVehicle,
  findInsertPosition,
  UNASSIGNED_COLOR,
} from "../../lib/map-utils.tsx";
import {
  UNASSIGNED_CONTAINER,
  resolveDropOperation,
  operationToAssignRequest,
} from "../../lib/dnd.ts";
import { vehiclesById as vehiclesByIdFn, vehicleRoute } from "../../lib/selectors.ts";
import { wouldExceedCapacity } from "../../lib/selectors.ts";
import { useAssignMutation } from "../../hooks/useAssignMutation.ts";
import { useToastStore } from "../../stores/toast.store.ts";
import { OrderMarker } from "./OrderMarker.tsx";
import { VehicleDepotMarker } from "./VehicleDepotMarker.tsx";
import { RoutePolyline } from "./RoutePolyline.tsx";
import { MapLegend } from "./MapLegend.tsx";

/* ------------------------------------------------------------------ */
/*  Fix Leaflet's default icon paths (broken by Vite bundler)         */
/* ------------------------------------------------------------------ */
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

/* ------------------------------------------------------------------ */
/*  Auto-fit bounds sub-component                                      */
/* ------------------------------------------------------------------ */

function FitBounds({ state }: { state: StateResponse }) {
  const map = useMap();
  const prevBoundsRef = useRef<string>("");

  useEffect(() => {
    const bounds = computeBounds(state);
    if (!bounds) return;

    // Only re-fit if bounds actually changed (avoid unnecessary animation)
    const boundsKey = JSON.stringify(bounds);
    if (boundsKey === prevBoundsRef.current) return;
    prevBoundsRef.current = boundsKey;

    map.fitBounds(bounds as L.LatLngBoundsExpression, {
      padding: [40, 40],
      maxZoom: 14,
      animate: true,
      duration: 0.5,
    });
  }, [map, state]);

  return null;
}

/* ------------------------------------------------------------------ */
/*  Map click handler for location picker                              */
/* ------------------------------------------------------------------ */

function MapClickHandler({ callback }: { callback: LocationPickerCallback }) {
  const stopPicker = useUIStore((s) => s.stopLocationPicker);

  useMapEvents({
    click(e) {
      callback(
        Math.round(e.latlng.lat * 1_000_000) / 1_000_000,
        Math.round(e.latlng.lng * 1_000_000) / 1_000_000,
      );
      stopPicker();
    },
  });

  return null;
}

/* ------------------------------------------------------------------ */
/*  MapPane                                                            */
/* ------------------------------------------------------------------ */

interface MapPaneProps {
  state: StateResponse;
}

export function MapPane({ state }: MapPaneProps) {
  /* ---- Selection sync with dispatch board ---- */
  const selectedOrderId = useUIStore((s) => s.selectedOrderId);
  const selectOrder = useUIStore((s) => s.selectOrder);

  /* ---- Assign mutation (same as dispatch board DnD) ---- */
  const assignMutation = useAssignMutation();
  const addToast = useToastStore((s) => s.addToast);

  /* ---- Location picker mode ---- */
  const pickerCallback = useUIStore((s) => s.locationPickerCallback);
  const stopPicker = useUIStore((s) => s.stopLocationPicker);
  const isPickerActive = pickerCallback !== null;

  /* ---- Legend toggle state ---- */
  const [hiddenVehicles, setHiddenVehicles] = useState<Set<string>>(new Set());

  const handleToggleVehicle = useCallback((vehicleId: string) => {
    setHiddenVehicles((prev) => {
      const next = new Set(prev);
      if (next.has(vehicleId)) next.delete(vehicleId);
      else next.add(vehicleId);
      return next;
    });
  }, []);

  /* ---- Derived map data (memoized for performance) ---- */
  const colorMap = useMemo(
    () => buildColorMap(state.vehicles),
    [state.vehicles],
  );

  const vehiclesMap = useMemo(
    () => vehiclesByIdFn(state),
    [state],
  );

  const orderVehicleMap = useMemo(
    () => buildOrderVehicleMap(state),
    [state],
  );

  const stopNumberMap = useMemo(
    () => buildStopNumberMap(state),
    [state],
  );

  const routeGeometries = useMemo(
    () => buildRouteGeometries(state, colorMap),
    [state, colorMap],
  );

  const unassignedCount = state.unassignedOrderIds.length;

  /* ---- Visible routes (filtered by legend) ---- */
  const visibleRoutes = useMemo(
    () => routeGeometries.filter((r) => !hiddenVehicles.has(r.vehicleId)),
    [routeGeometries, hiddenVehicles],
  );

  /* ---- Visible vehicles for depot markers ---- */
  const visibleVehicles = useMemo(
    () => state.vehicles.filter((v) => !hiddenVehicles.has(v.id)),
    [state.vehicles, hiddenVehicles],
  );

  /* ---- All orders (always shown; color reflects assignment) ---- */
  const ordersWithMeta = useMemo(() => {
    return state.orders.map((order) => {
      const vehicleId = orderVehicleMap[order.id];
      const isHidden = vehicleId ? hiddenVehicles.has(vehicleId) : false;
      const vehicle = vehicleId ? vehiclesMap[vehicleId] : undefined;
      return {
        order,
        color: isHidden
          ? UNASSIGNED_COLOR
          : vehicleId
            ? (colorMap[vehicleId] ?? UNASSIGNED_COLOR)
            : UNASSIGNED_COLOR,
        vehicleName: isHidden ? undefined : vehicle?.name,
        stopNumber: isHidden ? undefined : stopNumberMap[order.id],
        isSelected: order.id === selectedOrderId,
      };
    });
  }, [
    state.orders,
    orderVehicleMap,
    hiddenVehicles,
    vehiclesMap,
    colorMap,
    stopNumberMap,
    selectedOrderId,
  ]);

  /* ---- Drag-and-drop: reassign order to nearest vehicle ---- */
  const handleMarkerDragEnd = useCallback(
    (order: Order, latlng: L.LatLng) => {
      const nearest = findNearestVehicle(latlng.lat, latlng.lng, state);
      if (!nearest) return;

      // Determine source container
      const orderVehicle = orderVehicleMap[order.id];
      const sourceContainer = orderVehicle ?? UNASSIGNED_CONTAINER;
      const destContainer = nearest.vehicleId;

      // Determine source index
      const sourceIndex =
        sourceContainer === UNASSIGNED_CONTAINER
          ? Math.max(0, state.unassignedOrderIds.indexOf(order.id))
          : Math.max(0, vehicleRoute(state, sourceContainer).indexOf(order.id));

      // Determine destination index (cheapest insertion)
      const destIndex = findInsertPosition(
        order.location.lat,
        order.location.lng,
        state,
        destContainer,
      );

      const operation = resolveDropOperation(
        order.id,
        sourceContainer,
        destContainer,
        sourceIndex,
        destIndex,
      );

      const request = operationToAssignRequest(operation, state.rev);
      if (!request) return;

      // Capacity soft-constraint: warn but don't block
      if (wouldExceedCapacity(state, destContainer, order.weight_kg)) {
        addToast({
          variant: "warning",
          title: "Capacity exceeded",
          description: `Adding this order would overload ${nearest.vehicleName}.`,
        });
      }

      assignMutation.mutate(request);
    },
    [state, orderVehicleMap, assignMutation, addToast],
  );

  /* ---- Default center (Vienna, AT / common logistics demo area) ---- */
  const defaultCenter: [number, number] = [48.2082, 16.3738];

  return (
    <div className={`map-pane ${isPickerActive ? "map-pane--picking" : ""}`}>
      {/* ---- Location picker banner ---- */}
      {isPickerActive && (
        <div className="map-pane__picker-banner">
          <span>Click on the map to select a location</span>
          <button className="btn btn--sm" onClick={stopPicker}>
            Cancel
          </button>
        </div>
      )}

      <MapContainer
        center={defaultCenter}
        zoom={12}
        className="map-container"
        zoomControl={true}
        attributionControl={true}
      >
        {/* ---- Tile layer (OpenStreetMap, dark-ish) ---- */}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />

        {/* ---- Auto-fit bounds ---- */}
        <FitBounds state={state} />

        {/* ---- Location picker click handler ---- */}
        {pickerCallback && <MapClickHandler callback={pickerCallback} />}

        {/* ---- Route polylines (rendered first, below markers) ---- */}
        {visibleRoutes.map((route) => (
          <RoutePolyline
            key={route.vehicleId}
            route={route}
            vehicleName={vehiclesMap[route.vehicleId]?.name ?? route.vehicleId}
          />
        ))}

        {/* ---- Vehicle depot markers ---- */}
        {visibleVehicles.map((vehicle) => (
          <VehicleDepotMarker
            key={`depot-${vehicle.id}`}
            vehicle={vehicle}
            color={colorMap[vehicle.id] ?? UNASSIGNED_COLOR}
          />
        ))}

        {/* ---- Order markers ---- */}
        {ordersWithMeta.map(({ order, color, vehicleName, stopNumber, isSelected }) => (
          <OrderMarker
            key={order.id}
            order={order}
            color={color}
            vehicleName={vehicleName}
            stopNumber={stopNumber}
            isSelected={isSelected}
            onSelect={selectOrder}
            onDragEnd={handleMarkerDragEnd}
          />
        ))}
      </MapContainer>

      {/* ---- Legend overlay ---- */}
      <MapLegend
        vehicles={state.vehicles}
        colorMap={colorMap}
        hiddenVehicles={hiddenVehicles}
        onToggleVehicle={handleToggleVehicle}
        unassignedCount={unassignedCount}
      />
    </div>
  );
}
