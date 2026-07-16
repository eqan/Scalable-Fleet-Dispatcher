/**
 * Map utilities -- vehicle colors, bounds, marker factories, and popup components.
 *
 * Design:
 *   - Pure functions for colors, bounds, geometry (testable, DRY).
 *   - Deterministic color palette: same vehicle always gets same color.
 *   - Smart name-based color matching: "Blue Van" → blue, "Red Truck" → red.
 *   - Leaflet DivIcon factories for custom SVG markers (no image deps).
 *   - React popup components (XSS-safe — JSX auto-escapes all strings).
 */

import React from "react";
import L from "leaflet";
import type { StateResponse, Vehicle, Order } from "@repo/shared";
import { ordersById, vehicleRoute } from "./selectors.ts";

/* ------------------------------------------------------------------ */
/*  Vehicle color palette                                              */
/* ------------------------------------------------------------------ */

/** High-contrast palette for vehicle routes (8 distinct colors). */
const PALETTE = [
  "#3b82f6", // blue
  "#ef4444", // red
  "#22c55e", // green
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
] as const;

/** Color keywords detected in vehicle names → override palette index. */
const NAME_COLOR_MAP: Record<string, string> = {
  blue: "#3b82f6",
  red: "#ef4444",
  green: "#22c55e",
  yellow: "#eab308",
  orange: "#f97316",
  purple: "#8b5cf6",
  pink: "#ec4899",
  cyan: "#06b6d4",
  white: "#94a3b8",
  black: "#64748b",
};

/** Unassigned order marker color. */
export const UNASSIGNED_COLOR = "#6b7280"; // gray-500

/**
 * Get a deterministic color for a vehicle.
 * Checks vehicle name for color keywords first (e.g. "Blue Van" → blue).
 * Falls back to palette index for consistent assignment.
 */
export function vehicleColor(vehicle: Vehicle, index: number): string {
  const nameLower = vehicle.name.toLowerCase();
  for (const [keyword, color] of Object.entries(NAME_COLOR_MAP)) {
    if (nameLower.includes(keyword)) return color;
  }
  return PALETTE[index % PALETTE.length]!;
}

/** Build a vehicleId → color map for the entire state. */
export function buildColorMap(
  vehicles: Vehicle[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i]!;
    map[v.id] = vehicleColor(v, i);
  }
  return map;
}

/* ------------------------------------------------------------------ */
/*  Order → vehicle assignment lookup                                  */
/* ------------------------------------------------------------------ */

/** Build orderId → vehicleId map (undefined = unassigned). */
export function buildOrderVehicleMap(
  state: StateResponse,
): Record<string, string | undefined> {
  const map: Record<string, string | undefined> = {};
  for (const a of state.solution.assignments) {
    for (const orderId of a.route) {
      map[orderId] = a.vehicle_id;
    }
  }
  return map;
}

/** Build orderId → stop number (1-based) within its vehicle route. */
export function buildStopNumberMap(
  state: StateResponse,
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const a of state.solution.assignments) {
    for (let i = 0; i < a.route.length; i++) {
      map[a.route[i]!] = i + 1;
    }
  }
  return map;
}

/* ------------------------------------------------------------------ */
/*  Route geometry for polylines                                       */
/* ------------------------------------------------------------------ */

export interface RouteGeometry {
  vehicleId: string;
  color: string;
  /** [lat, lng] coordinates: depot → stop1 → stop2 → ... */
  points: [number, number][];
}

/** Build route polyline data for all vehicles. */
export function buildRouteGeometries(
  state: StateResponse,
  colorMap: Record<string, string>,
): RouteGeometry[] {
  const lookup = ordersById(state);
  const vehicleMap: Record<string, Vehicle> = {};
  for (const v of state.vehicles) vehicleMap[v.id] = v;

  const routes: RouteGeometry[] = [];

  for (const vehicle of state.vehicles) {
    const route = vehicleRoute(state, vehicle.id);
    if (route.length === 0) continue;

    const points: [number, number][] = [
      [vehicle.start_location.lat, vehicle.start_location.lng],
    ];

    for (const orderId of route) {
      const order = lookup[orderId];
      if (order) {
        points.push([order.location.lat, order.location.lng]);
      }
    }

    routes.push({
      vehicleId: vehicle.id,
      color: colorMap[vehicle.id] ?? UNASSIGNED_COLOR,
      points,
    });
  }

  return routes;
}

/* ------------------------------------------------------------------ */
/*  Bounds calculation (fit all markers)                                */
/* ------------------------------------------------------------------ */

/** Compute Leaflet bounds encompassing all vehicles and orders. */
export function computeBounds(
  state: StateResponse,
): L.LatLngBoundsExpression | null {
  const allPoints: [number, number][] = [];

  for (const v of state.vehicles) {
    allPoints.push([v.start_location.lat, v.start_location.lng]);
  }
  for (const o of state.orders) {
    allPoints.push([o.location.lat, o.location.lng]);
  }

  if (allPoints.length === 0) return null;
  if (allPoints.length === 1) {
    const p = allPoints[0]!;
    return [
      [p[0] - 0.01, p[1] - 0.01],
      [p[0] + 0.01, p[1] + 0.01],
    ];
  }

  return L.latLngBounds(allPoints.map(([lat, lng]) => L.latLng(lat, lng)));
}

/* ------------------------------------------------------------------ */
/*  Geo distance helpers (for drag-and-drop proximity detection)       */
/* ------------------------------------------------------------------ */

/** Haversine distance between two lat/lng points in meters. */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Minimum distance (meters) from point P to the line segment A→B.
 * Projects P onto AB; if the projection falls outside the segment,
 * clamps to the nearest endpoint.
 *
 * Uses a flat (equirectangular) approximation scaled by cos(lat) —
 * accurate enough at city scale for proximity comparison.
 */
function pointToSegmentDistance(
  pLat: number,
  pLng: number,
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  // Work in a flat coordinate system (meters) for projection math
  const cosLat = Math.cos(((pLat + aLat + bLat) / 3) * (Math.PI / 180));
  const toX = (lng: number) => lng * cosLat;
  const toY = (lat: number) => lat;

  const px = toX(pLng), py = toY(pLat);
  const ax = toX(aLng), ay = toY(aLat);
  const bx = toX(bLng), by = toY(bLat);

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // Segment is a zero-length point — just use haversine
    return haversineDistance(pLat, pLng, aLat, aLng);
  }

  // Project P onto AB, clamped to [0,1]
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const closestLng = aLng + t * (bLng - aLng);
  const closestLat = aLat + t * (bLat - aLat);

  return haversineDistance(pLat, pLng, closestLat, closestLng);
}

export interface NearestVehicleResult {
  vehicleId: string;
  vehicleName: string;
  distanceMeters: number;
}

/**
 * Find the vehicle whose route **path** is closest to the given point.
 *
 * For each vehicle, computes the minimum distance from the drop point to
 * every line segment of its route polyline (depot → stop1 → stop2 → …).
 * This correctly resolves crossing/overlapping routes — the vehicle whose
 * path line is nearest wins, not just the one with the closest stop.
 *
 * Returns null if no vehicles exist.
 */
export function findNearestVehicle(
  lat: number,
  lng: number,
  state: StateResponse,
): NearestVehicleResult | null {
  if (state.vehicles.length === 0) return null;

  const lookup = ordersById(state);
  let best: NearestVehicleResult | null = null;

  for (const v of state.vehicles) {
    // Build ordered path: depot → stop1 → stop2 → …
    const path: [number, number][] = [
      [v.start_location.lat, v.start_location.lng],
    ];
    const route = vehicleRoute(state, v.id);
    for (const orderId of route) {
      const order = lookup[orderId];
      if (order) path.push([order.location.lat, order.location.lng]);
    }

    // Find minimum distance from drop point to any segment of the path
    let minDist = Infinity;

    if (path.length === 1) {
      // Vehicle has no stops — just distance to the depot
      minDist = haversineDistance(lat, lng, path[0]![0], path[0]![1]);
    } else {
      for (let i = 0; i < path.length - 1; i++) {
        const [aLat, aLng] = path[i]!;
        const [bLat, bLng] = path[i + 1]!;
        const d = pointToSegmentDistance(lat, lng, aLat, aLng, bLat, bLng);
        if (d < minDist) minDist = d;
      }
    }

    if (!best || minDist < best.distanceMeters) {
      best = { vehicleId: v.id, vehicleName: v.name, distanceMeters: minDist };
    }
  }

  return best;
}

/**
 * Find the best insertion index within a vehicle's route for a new order.
 * Uses cheapest-insertion: finds the route segment where inserting causes
 * the least total distance increase. Returns 0 if route is empty.
 */
export function findInsertPosition(
  lat: number,
  lng: number,
  state: StateResponse,
  vehicleId: string,
): number {
  const route = vehicleRoute(state, vehicleId);
  if (route.length === 0) return 0;

  const lookup = ordersById(state);
  const vehicle = state.vehicles.find((v) => v.id === vehicleId);

  // Build coordinate list: [depot, stop1, stop2, ...]
  const coords: [number, number][] = [];
  if (vehicle) {
    coords.push([vehicle.start_location.lat, vehicle.start_location.lng]);
  }
  for (const orderId of route) {
    const order = lookup[orderId];
    if (order) coords.push([order.location.lat, order.location.lng]);
  }

  let bestIdx = route.length;
  let bestCost = Infinity;

  for (let i = 0; i < coords.length; i++) {
    const [aLat, aLng] = coords[i]!;
    const next = coords[i + 1];

    const costToNew = haversineDistance(aLat, aLng, lat, lng);
    const costFromNew = next ? haversineDistance(lat, lng, next[0], next[1]) : 0;
    const removedEdge = next ? haversineDistance(aLat, aLng, next[0], next[1]) : 0;
    const insertionCost = costToNew + costFromNew - removedEdge;

    if (insertionCost < bestCost) {
      bestCost = insertionCost;
      bestIdx = i;
    }
  }

  return Math.min(bestIdx, route.length);
}

/* ------------------------------------------------------------------ */
/*  Custom DivIcon factories (SVG, no image dependencies)              */
/* ------------------------------------------------------------------ */

/** Circular marker for orders (color-coded, with optional stop number). */
export function orderIcon(
  color: string,
  stopNumber?: number,
  isSelected = false,
): L.DivIcon {
  const size = isSelected ? 28 : 22;
  const border = isSelected ? "3px solid #fff" : "2px solid rgba(255,255,255,0.7)";
  const shadow = isSelected ? "0 0 0 3px " + color : "0 1px 3px rgba(0,0,0,0.4)";
  const label = stopNumber != null ? `<span style="color:#fff;font-size:10px;font-weight:700;font-family:Inter,system-ui,sans-serif;">${stopNumber}</span>` : "";

  return L.divIcon({
    className: "map-marker-order",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:${border};box-shadow:${shadow};display:flex;align-items:center;justify-content:center;">${label}</div>`,
  });
}

/** Diamond marker for vehicle depots (distinct from order circles). */
export function depotIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "map-marker-depot",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    html: `<div style="width:18px;height:18px;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.5);transform:rotate(45deg);"></div>`,
  });
}

/* ------------------------------------------------------------------ */
/*  Popup content components (XSS-safe — JSX auto-escapes strings)     */
/* ------------------------------------------------------------------ */

const popupFont: React.CSSProperties = {
  fontFamily: "Inter, system-ui, sans-serif",
  minWidth: 140,
};

const popupTitle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 13,
  marginBottom: 2,
};

const popupDetail: React.CSSProperties = {
  fontSize: 11,
  color: "#cbd5e1",
};

const popupMuted: React.CSSProperties = {
  fontSize: 11,
  color: "#94a3b8",
};

interface OrderPopupContentProps {
  order: Order;
  vehicleName?: string;
  stopNumber?: number;
}

export function OrderPopupContent({
  order,
  vehicleName,
  stopNumber,
}: OrderPopupContentProps) {
  return (
    <div style={popupFont}>
      <div style={popupTitle}>{order.id}</div>
      <div style={popupDetail}>
        {order.weight_kg} kg &middot; {order.service_time_min} min
      </div>
      <div style={popupDetail}>
        {order.location.lat.toFixed(4)}, {order.location.lng.toFixed(4)}
      </div>
      {vehicleName ? (
        <div style={{ marginTop: 4, fontSize: 11, color: "#94a3b8" }}>
          Assigned to <strong>{vehicleName}</strong>
          {stopNumber != null ? ` (stop #${stopNumber})` : ""}
        </div>
      ) : (
        <div style={{ marginTop: 4, fontSize: 11, color: "#f59e0b" }}>
          Unassigned
        </div>
      )}
    </div>
  );
}

interface DepotPopupContentProps {
  vehicle: Vehicle;
}

export function DepotPopupContent({ vehicle }: DepotPopupContentProps) {
  return (
    <div style={{ ...popupFont, minWidth: 120 }}>
      <div style={popupTitle}>{vehicle.name}</div>
      <div style={popupMuted}>Depot / Start Location</div>
      <div style={popupDetail}>
        {vehicle.start_location.lat.toFixed(4)},{" "}
        {vehicle.start_location.lng.toFixed(4)}
      </div>
      <div style={popupDetail}>Capacity: {vehicle.capacity_kg} kg</div>
    </div>
  );
}

