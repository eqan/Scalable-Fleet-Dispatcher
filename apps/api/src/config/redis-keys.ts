/**
 * Redis keyspace constants.
 * All keys namespaced under `ws:default:` for future multi-tenant support.
 */
const PREFIX = "ws:default" as const;

export const REDIS_KEYS = {
  PREFIX,
  vehicles: `${PREFIX}:vehicles`,
  orders: `${PREFIX}:orders`,
  route: (vehicleId: string) => `${PREFIX}:route:${vehicleId}`,
  unassigned: `${PREFIX}:unassigned`,
  orderToVehicle: `${PREFIX}:orderToVehicle`,
  rev: `${PREFIX}:rev`,
  lastSavedRev: `${PREFIX}:lastSavedRev`,
  meta: `${PREFIX}:meta`,
  hydrating: `${PREFIX}:hydrating`,
} as const;

export const STREAM_KEYS = {
  events: "events:stream",
  results: "results:stream",
  sseReplay: "sse:replay",
  /** Pub/Sub channel so every API replica can fan out live SSE (not just the mutating pod). */
  sseLive: "sse:live",
  groups: {
    optWorkers: "opt-workers",
    apiUpdaters: "api-updaters",
  },
} as const;
