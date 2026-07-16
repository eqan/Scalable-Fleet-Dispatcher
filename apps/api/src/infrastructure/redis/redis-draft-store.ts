import type Redis from "ioredis";
import type { IDraftStore } from "../../domain/ports/draft-store.port.ts";
import type { Vehicle, Order, Solution, StateResponse } from "@repo/shared";
import { VehicleSchema, OrderSchema } from "@repo/shared";
import { env } from "../../config/env.ts";
import { AppError } from "../../domain/errors.ts";
import { REDIS_KEYS } from "../../config/redis-keys.ts";
import { LUA_ERR } from "./lua/scripts.ts";
import type { LuaScriptManager } from "./lua/script-manager.ts";

/* ------------------------------------------------------------------ */
/*  DRY helpers                                                        */
/* ------------------------------------------------------------------ */

/**
 * Check a Lua script's integer return code.
 * Positive = new rev (success). Negative = error code -> throw AppError.
 * This replaces try/catch on redis.error_reply -- no exception overhead
 * for expected business-logic outcomes like "entity not found."
 */
const checkLuaResult = (
  result: number,
  ctx: { orderId?: string; vehicleId?: string; baseRev?: number },
): number => {
  if (result > 0) return result;

  switch (result) {
    case LUA_ERR.ORDER_NOT_FOUND:
      throw AppError.notFound("Order", ctx.orderId);
    case LUA_ERR.VEHICLE_NOT_FOUND:
      throw AppError.notFound("Vehicle", ctx.vehicleId);
    case LUA_ERR.REV_CONFLICT:
      throw AppError.conflict(
        `Revision conflict: expected rev ${ctx.baseRev}, state has changed`,
      );
    case LUA_ERR.CAPACITY_EXCEEDED:
      throw AppError.capacityExceeded(
        `Operation would exceed vehicle capacity`,
      );
    default:
      throw AppError.internal(`Unknown Lua error code: ${result}`);
  }
};

/** Extract a typed value from a pipeline result array. */
const pipeResult = <T>(
  results: [Error | null, unknown][] | null,
  index: number,
): T => {
  if (!results) throw AppError.internal("Redis pipeline returned null");
  const entry = results[index];
  if (!entry) throw AppError.internal(`Pipeline result missing at index ${index}`);
  const [err, value] = entry;
  if (err) throw err;
  return value as T;
};

/** Route key prefix (without vehicleId suffix). */
const ROUTE_PREFIX = `${REDIS_KEYS.PREFIX}:route:`;

/** Convert optional baseRev to Lua arg (-1 = skip OCC check). */
const revArg = (baseRev?: number): number => baseRev ?? -1;

const parseVehicle = (raw: string): Vehicle => {
  const parsed = JSON.parse(raw) as unknown;
  return env.STATE_READ_VALIDATE
    ? VehicleSchema.parse(parsed)
    : (parsed as Vehicle);
};

const parseOrder = (raw: string): Order => {
  const parsed = JSON.parse(raw) as unknown;
  return env.STATE_READ_VALIDATE
    ? OrderSchema.parse(parsed)
    : (parsed as Order);
};

/* ------------------------------------------------------------------ */
/*  Implementation                                                     */
/* ------------------------------------------------------------------ */

export class RedisDraftStore implements IDraftStore {
  constructor(
    private readonly redis: Redis,
    private readonly scripts: LuaScriptManager,
  ) {}

  /* ========================= State retrieval ======================== */

  async getFullState(): Promise<StateResponse> {
    // Pipeline 1: core hashes + unassigned set + rev
    const p1 = this.redis.pipeline();
    p1.hgetall(REDIS_KEYS.vehicles);    // 0
    p1.hgetall(REDIS_KEYS.orders);      // 1
    p1.smembers(REDIS_KEYS.unassigned); // 2
    p1.get(REDIS_KEYS.rev);             // 3
    const r1 = await p1.exec();

    const vehiclesMap = pipeResult<Record<string, string>>(r1, 0);
    const ordersMap = pipeResult<Record<string, string>>(r1, 1);
    const unassignedOrderIds = pipeResult<string[]>(r1, 2);
    const revStr = pipeResult<string | null>(r1, 3);

    const vehicles = Object.values(vehiclesMap).map(parseVehicle);
    const orders = Object.values(ordersMap).map(parseOrder);
    const rev = revStr ? parseInt(revStr, 10) : 0;

    // Pipeline 2: routes for each vehicle
    const vehicleIds = Object.keys(vehiclesMap);
    const p2 = this.redis.pipeline();
    for (const vid of vehicleIds) {
      p2.lrange(REDIS_KEYS.route(vid), 0, -1);
    }
    const r2 = await p2.exec();

    const assignments = vehicleIds.map((vid, i) => ({
      vehicle_id: vid,
      route: pipeResult<string[]>(r2, i),
    }));

    return {
      vehicles,
      orders,
      solution: { assignments },
      unassignedOrderIds,
      rev,
    };
  }

  async getRev(): Promise<number | null> {
    const val = await this.redis.get(REDIS_KEYS.rev);
    return val !== null ? parseInt(val, 10) : null;
  }

  /* ========================= Vehicle ops ============================ */

  async setVehicle(
    vehicle: Vehicle,
    baseRev?: number,
  ): Promise<{ rev: number }> {
    const result = await this.scripts.exec<number>(
      this.redis,
      "setVehicle",
      [
        REDIS_KEYS.vehicles,
        REDIS_KEYS.rev,
        REDIS_KEYS.orders,
        REDIS_KEYS.orderToVehicle,
      ],
      [vehicle.id, JSON.stringify(vehicle), revArg(baseRev), `${REDIS_KEYS.PREFIX}:route:`],
    );
    return { rev: checkLuaResult(result, { vehicleId: vehicle.id, baseRev }) };
  }

  async getVehicle(id: string): Promise<Vehicle | null> {
    const raw = await this.redis.hget(REDIS_KEYS.vehicles, id);
    if (!raw) return null;
    return parseVehicle(raw);
  }

  async deleteVehicle(
    id: string,
    baseRev?: number,
  ): Promise<{ unassignedOrderIds: string[]; rev: number }> {
    const [csv, revOrErr] = await this.scripts.exec<[string, number]>(
      this.redis,
      "deleteVehicle",
      [
        REDIS_KEYS.vehicles,
        REDIS_KEYS.orderToVehicle,
        REDIS_KEYS.unassigned,
        REDIS_KEYS.rev,
      ],
      [id, REDIS_KEYS.route(id), revArg(baseRev)],
    );

    const rev = checkLuaResult(revOrErr, { vehicleId: id, baseRev });
    const unassignedOrderIds = csv ? csv.split(",").filter(Boolean) : [];
    return { unassignedOrderIds, rev };
  }

  /* ========================= Order ops ============================== */

  async setOrder(
    order: Order,
    baseRev?: number,
  ): Promise<{ rev: number }> {
    const result = await this.scripts.exec<number>(
      this.redis,
      "setOrder",
      [
        REDIS_KEYS.orders,
        REDIS_KEYS.unassigned,
        REDIS_KEYS.orderToVehicle,
        REDIS_KEYS.rev,
        REDIS_KEYS.vehicles,
      ],
      [order.id, JSON.stringify(order), revArg(baseRev), `${REDIS_KEYS.PREFIX}:route:`],
    );
    return { rev: checkLuaResult(result, { orderId: order.id, baseRev }) };
  }

  async getOrder(id: string): Promise<Order | null> {
    const raw = await this.redis.hget(REDIS_KEYS.orders, id);
    if (!raw) return null;
    return parseOrder(raw);
  }

  async deleteOrder(
    id: string,
    baseRev?: number,
  ): Promise<{ rev: number }> {
    const result = await this.scripts.exec<number>(
      this.redis,
      "deleteOrder",
      [
        REDIS_KEYS.orders,
        REDIS_KEYS.orderToVehicle,
        REDIS_KEYS.unassigned,
        REDIS_KEYS.rev,
      ],
      [id, ROUTE_PREFIX, revArg(baseRev)],
    );
    return { rev: checkLuaResult(result, { orderId: id, baseRev }) };
  }

  /* ========================= Assignment ops ========================= */

  async assignOrder(
    orderId: string,
    vehicleId: string,
    position?: number,
    baseRev?: number,
  ): Promise<{ rev: number }> {
    const result = await this.scripts.exec<number>(
      this.redis,
      "assignOrder",
      [
        REDIS_KEYS.orderToVehicle,
        REDIS_KEYS.unassigned,
        REDIS_KEYS.rev,
        REDIS_KEYS.orders,
        REDIS_KEYS.vehicles,
      ],
      [orderId, vehicleId, position ?? -1, ROUTE_PREFIX, revArg(baseRev)],
    );
    return { rev: checkLuaResult(result, { orderId, vehicleId, baseRev }) };
  }

  /* ========================= Route ops ============================== */

  async updateRoute(
    vehicleId: string,
    route: string[],
    baseRev: number,
  ): Promise<{ rev: number }> {
    const result = await this.scripts.exec<number>(
      this.redis,
      "updateRoute",
      [
        REDIS_KEYS.rev,
        REDIS_KEYS.orderToVehicle,
        REDIS_KEYS.unassigned,
        REDIS_KEYS.orders,
        REDIS_KEYS.vehicles,
      ],
      [REDIS_KEYS.route(vehicleId), vehicleId, revArg(baseRev), ...route],
    );
    return { rev: checkLuaResult(result, { vehicleId, baseRev }) };
  }

  /* ========================= Hydration ============================== */

  async hydrateFromSnapshot(
    vehicles: Vehicle[],
    orders: Order[],
    solution: Solution,
    rev: number,
  ): Promise<void> {
    // Step 1: SCAN and delete ALL route keys in the namespace.
    // This clears stale routes from vehicles that were deleted since the
    // last snapshot — something the old per-vehicle DEL approach missed.
    await this.deleteKeysByPattern(`${ROUTE_PREFIX}*`);

    const p = this.redis.pipeline();

    // Clear core hashes + sets
    p.del(REDIS_KEYS.vehicles);
    p.del(REDIS_KEYS.orders);
    p.del(REDIS_KEYS.unassigned);
    p.del(REDIS_KEYS.orderToVehicle);

    const assignedOrderIds = new Set<string>();

    // Seed vehicles
    for (const v of vehicles) {
      p.hset(REDIS_KEYS.vehicles, v.id, JSON.stringify(v));
    }

    // Seed orders
    for (const o of orders) {
      p.hset(REDIS_KEYS.orders, o.id, JSON.stringify(o));
    }

    // Build routes + orderToVehicle from solution assignments
    for (const a of solution.assignments) {
      for (const orderId of a.route) {
        p.rpush(REDIS_KEYS.route(a.vehicle_id), orderId);
        p.hset(REDIS_KEYS.orderToVehicle, orderId, a.vehicle_id);
        assignedOrderIds.add(orderId);
      }
    }

    // Compute unassigned = all orders - assigned
    for (const o of orders) {
      if (!assignedOrderIds.has(o.id)) {
        p.sadd(REDIS_KEYS.unassigned, o.id);
        p.hset(REDIS_KEYS.orderToVehicle, o.id, "UNASSIGNED");
      }
    }

    // Restore persisted revision (not hardcoded "1")
    p.set(REDIS_KEYS.rev, String(rev));

    await p.exec();
  }

  /* ========================= DRY helpers ============================= */

  /**
   * SCAN-based key deletion for a glob pattern.
   * Uses SCAN to avoid blocking Redis with a KEYS command on large keyspaces.
   */
  private async deleteKeysByPattern(pattern: string): Promise<void> {
    let cursor = "0";
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100,
      );
      cursor = nextCursor;
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } while (cursor !== "0");
  }

  /* ========================= Diagnostics ============================ */

  async ping(): Promise<boolean> {
    const reply = await this.redis.ping();
    return reply === "PONG";
  }
}
