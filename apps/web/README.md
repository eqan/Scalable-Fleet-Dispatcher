### Mission Control Frontend

> React + TypeScript dispatch dashboard with Zustand + TanStack Query, SSE real-time sync, and end-to-end type safety via `@repo/shared` Zod schemas.

---

## Table of Contents

- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [State Management Strategy](#state-management-strategy)
- [Real-time Updates (SSE)](#real-time-updates-sse)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Type Safety](#type-safety)
- [Docker](#docker)
- [Features](#features)

---

## Architecture

```
┌─────────────────────────────────────────────┐
│                  React App                   │
│                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ TanStack  │  │ Zustand   │  │  SSE     │  │
│  │ Query     │  │ UI Store  │  │  Client  │  │
│  │ (server   │  │ (local    │  │ (realtime│  │
│  │  state)   │  │  state)   │  │  push)   │  │
│  └─────┬─────┘  └──────────┘  └────┬─────┘   │
│        │                           │         │
│        └──────────┬────────────────┘         │
│                   ▼                          │
│          @repo/shared                        │
│    (Zod schemas + inferred types)            │
└───────────────────┬─────────────────────────┘
                    │ HTTP + SSE
                    ▼
            Express API (apps/api)
```

The frontend follows a clean separation between **server state** (TanStack Query) and **UI state** (Zustand), unified by a **shared type system** (`@repo/shared`).

---

## Tech Stack

| Concern | Library | Why |
|---------|---------|-----|
| **Build** | Vite 7 + Bun | Zero-config, fast HMR, native TS support |
| **UI** | React 19 | Component architecture, hooks, concurrent features |
| **Server state** | TanStack Query v5 | Cache management, optimistic mutations, auto-refetch |
| **UI state** | Zustand v5 | Lightweight, no boilerplate, scales without Redux overhead |
| **Type safety** | `@repo/shared` (Zod) | Same schemas validate API responses *and* generate TS types |
| **Language** | TypeScript (strict) | `strict: true`, `noUncheckedIndexedAccess: true` |

### Why TanStack Query + Zustand (Not Redux or Context)?

The task requires managing two fundamentally different kinds of state:

1. **Server state**: vehicles, orders, assignments, revision -- this comes from the API and must stay in sync. TanStack Query is purpose-built for this: it handles caching, background refetching, optimistic mutations, and cache invalidation on SSE events.

2. **UI state**: which order is selected, is the drawer open, which vehicle is optimizing, is there a drag in progress -- this is ephemeral and local. Zustand is a minimal store that handles this without Redux's ceremony.

Combining them avoids the common pitfall of stuffing server data into a global store (Redux) where staleness and cache invalidation become manual headaches.

---

## State Management Strategy

### Server State (TanStack Query)

```typescript
// Fetch the full planning state from Redis (via API)
const { data } = useQuery<StateResponse>({
  queryKey: ["hotState"],
  queryFn: () => fetch("/api/state").then(r => r.json()),
});
```

- **Mutations** (assign, CRUD, optimize, save) use `useMutation` with optimistic updates.
- **SSE events** invalidate the query cache, triggering a re-fetch of the latest state.
- The `staleTime` is set to 30s because SSE pushes updates proactively.

### UI State (Zustand)

Two stores handle all ephemeral UI concerns:

| Store | State | Purpose |
|-------|-------|---------|
| `connection.store.ts` | `isConnected` | SSE connection status indicator |
| `ui.store.ts` | `selectedOrderId`, `isDrawerOpen`, `optimizingVehicleIds`, `isDirty`, `isUnassignedCollapsed`, `locationPickerCallback` | Selection, drawer toggle, optimizing spinners, unsaved changes, collapsible panel, map location picker |

### Data Flow for a Mutation

```
User drags order to vehicle
  → Zustand: mark dirty
  → TanStack: optimistic cache update (instant UI)
  → fetch POST /api/assign { orderId, vehicleId }
  → API: Lua script executes atomically in Redis
  → API: SSE broadcast { kind: "order_assigned", rev }
  → TanStack: SSE event invalidates cache
  → TanStack: re-fetches authoritative state from Redis
  → UI converges to server truth (no flicker)
```

---

## Real-time Updates (SSE)

The API pushes state changes via **Server-Sent Events** (`GET /api/events`). The frontend listens via the browser-native `EventSource` API:

```typescript
const source = new EventSource("/api/events");
source.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // Invalidate TanStack Query cache → triggers re-fetch
  queryClient.invalidateQueries({ queryKey: ["hotState"] });
};
```

### Why SSE (Not WebSocket)?

- **One-way push is all we need**: The backend pushes updates; the frontend sends mutations via HTTP. WebSocket's bidirectional channel is unnecessary overhead.
- **Browser-native reconnection**: `EventSource` automatically reconnects on disconnect with `Last-Event-ID` support. No reconnection library needed.
- **Simpler infrastructure**: No WebSocket upgrade handshake, no ping/pong frames, no connection state management.
- **Proxy-friendly**: SSE works through any HTTP proxy or load balancer without special configuration.

---

## Project Structure

```
apps/web/
├── src/
│   ├── main.tsx               # Entry point: QueryClientProvider + StrictMode
│   ├── App.tsx                # Root component: fetches state, renders dashboard
│   ├── index.css              # Global styles (CSS variables, dark theme, toast system)
│   │
│   ├── components/
│   │   ├── dispatch/              # Dispatch board (DnD, vehicle columns, order cards)
│   │   │   ├── DispatchBoard.tsx      # DnD context + panel layout + capacity enforcement
│   │   │   ├── VehicleColumn.tsx      # Vehicle route column with capacity bar
│   │   │   ├── UnassignedPanel.tsx    # Unassigned orders panel
│   │   │   └── OrderCard.tsx          # Draggable order card
│   │   ├── map/                   # Leaflet map pane (markers, routes, popups)
│   │   │   ├── MapPane.tsx            # Map container with auto-fit bounds
│   │   │   ├── OrderMarker.tsx        # Order markers (XSS-safe popup components)
│   │   │   ├── VehicleDepotMarker.tsx # Depot markers (XSS-safe popup components)
│   │   │   └── RoutePolyline.tsx      # Color-coded route polylines
│   │   ├── crud/                  # Master data drawer (vehicle/order CRUD forms)
│   │   └── shared/                # Reusable UI components (toolbar, empty state, etc.)
│   │
│   ├── hooks/                 # Custom hooks (mutations, keyboard shortcuts)
│   │   ├── useAssignMutation.ts       # Optimistic assign/unassign/reassign
│   │   ├── useOptimizeMutation.ts     # Async optimization request
│   │   ├── useSaveMutation.ts         # Save plan to MongoDB
│   │   └── useCrudMutations.ts        # Vehicle/order CRUD mutations
│   │
│   ├── providers/
│   │   └── SSEProvider.tsx        # EventSource client with reconnection + state_saved
│   │
│   ├── stores/                # Zustand stores (UI-only state)
│   │   ├── connection.store.ts    # SSE connection status
│   │   ├── ui.store.ts            # Selection, drawer, optimizing flags, dirty state
│   │   └── toast.store.ts         # Toast notification queue
│   │
│   ├── lib/                   # Pure utility functions
│   │   ├── selectors.ts           # Derived state selectors (routes, loads, capacity)
│   │   ├── map-utils.tsx          # Map colors, icons, bounds, popup components
│   │   ├── dnd.ts                 # DnD operation types and helpers
│   │   └── api.ts                 # Typed API client
│   │
│   └── assets/                # Static assets
│
├── public/                    # Public static files
├── index.html                 # SPA entry point
├── vite.config.ts             # Vite config + API proxy (/api -> localhost:4000)
├── tsconfig.json              # TypeScript project references
├── tsconfig.app.json          # App-specific TS config (strict mode)
├── eslint.config.js           # ESLint with React hooks + refresh plugins
├── Dockerfile                 # Multi-stage: bun build -> nginx serve
└── package.json
```

---

## Getting Started

### Local Development

```bash
# From the monorepo root
bun install

# Start the API first (the frontend proxies to it)
bun run dev:api

# Start the frontend dev server (separate terminal)
bun run dev:web
# Opens at http://localhost:5173
```

The Vite dev server proxies `/api/*` requests to `http://localhost:4000` (the API), so no CORS issues during development.

### Build for Production

```bash
bun run build:web
# Output: apps/web/dist/
```

---

## Type Safety

The frontend imports **the exact same Zod schemas** used by the API:

```typescript
import type { StateResponse, Vehicle, Order } from "@repo/shared";
```

This means:

- API response types are not manually maintained -- they're inferred from the schemas that the API actually validates against.
- If the API adds a required field to `VehicleSchema`, the frontend fails to compile until it handles the new field.
- Runtime validation is available via `StateResponseSchema.parse(data)` for untrusted data boundaries.

---

## Docker

The web app uses a **multi-stage Docker build**:

1. **Build stage** (Bun): Installs workspace dependencies, builds with Vite.
2. **Serve stage** (nginx:alpine): Serves the static SPA with a `try_files` fallback for client-side routing.

```dockerfile
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/shared/ packages/shared/
COPY apps/web/ apps/web/
RUN bun install --frozen-lockfile
WORKDIR /app/apps/web
RUN bun run build

FROM nginx:alpine
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
```

The image is ~25MB (nginx:alpine + static assets).

---

## Features

All planned features from the task specification are **fully implemented**:

| Feature | Description |
|---------|-------------|
| Dispatch Board | Collapsible unassigned panel, vehicle columns, custom collision detection for empty columns |
| Drag & Drop | `@dnd-kit` for assign / unassign / reassign / reorder with capacity warnings |
| Optimistic Mutations | TanStack Query `useMutation` with instant UI + rollback on conflict |
| SSE Sync Engine  | `EventSource` with reconnection + cache invalidation + `state_saved` handling |
| Master Data CRUD  | Custom drawer with React Hook Form + Zod validation for vehicles & orders |
| Map Location Picker | Click-on-map to fill lat/lng fields in create/edit forms (no manual coordinate entry) |
| Save Plan  | Button with dirty indicator + toast notification via Zustand toast store |
| Optimize Vehicle  | Per-vehicle button with Zustand spinner state + SSE result consumption |
| Map Pane (bonus)  | React Leaflet with color-coded markers, route polylines, and XSS-safe popups |
| Debug Panel (bonus)  | Connection status, revision, pending ops count, keyboard shortcut help |
