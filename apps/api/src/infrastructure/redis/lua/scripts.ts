/**
 * Lua scripts for atomic Redis state mutations.
 *
 * Conventions:
 *   - KEYS[]  = static keyspace keys (hashes, sets, rev counter)
 *   - ARGV[]  = dynamic arguments; last ARGV is always baseRev
 *   - Returns: positive integer = new rev (success)
 *              negative integer = error code (see LUA_ERR)
 *   - DELETE_VEHICLE returns {csv, rev_or_error} (multi-value)
 *
 * baseRev (Optimistic Concurrency Control):
 *   If baseRev >= 0, the script checks it against the current rev.
 *   If they don't match, the script returns REV_CONFLICT (-3)
 *   without mutating any state. Pass -1 to skip the check.
 */

/* ------------------------------------------------------------------ */
/*  Error codes (negative = error, positive = success / new rev)       */
/* ------------------------------------------------------------------ */

export const LUA_ERR = {
  ORDER_NOT_FOUND: -1,
  VEHICLE_NOT_FOUND: -2,
  REV_CONFLICT: -3,
  CAPACITY_EXCEEDED: -4,
} as const;

/* ------------------------------------------------------------------ */
/*  Reusable OCC check snippet (inlined into each script)              */
/*  Expects: revKey (local), baseRev (local number)                    */
/* ------------------------------------------------------------------ */

const OCC_CHECK = `
-- Optimistic Concurrency Control
if baseRev >= 0 then
  local currentRev = tonumber(redis.call('GET', revKey)) or 0
  if baseRev ~= currentRev then
    return -3
  end
end
`;

/* ------------------------------------------------------------------ */
/*  ASSIGN ORDER                                                       */
/*  Handles: assign / unassign / reassign / positional insert          */
/*                                                                     */
/*  KEYS[1] = orderToVehicle   KEYS[2] = unassigned                   */
/*  KEYS[3] = rev              KEYS[4] = orders                       */
/*  KEYS[5] = vehicles                                                 */
/*  ARGV[1] = orderId          ARGV[2] = targetVehicleId | UNASSIGNED */
/*  ARGV[3] = position (-1=append)  ARGV[4] = route key prefix        */
/*  ARGV[5] = baseRev (-1=skip)                                       */
/* ------------------------------------------------------------------ */
export const ASSIGN_ORDER = `
local orderToVehicle = KEYS[1]
local unassigned     = KEYS[2]
local revKey         = KEYS[3]
local ordersHash     = KEYS[4]
local vehiclesHash   = KEYS[5]

local orderId        = ARGV[1]
local targetVehicle  = ARGV[2]
local position       = tonumber(ARGV[3])
local routePrefix    = ARGV[4]
local baseRev        = tonumber(ARGV[5])

${OCC_CHECK}

if redis.call('HEXISTS', ordersHash, orderId) == 0 then
  return -1
end

if targetVehicle ~= 'UNASSIGNED' then
  if redis.call('HEXISTS', vehiclesHash, targetVehicle) == 0 then
    return -2
  end
end

-- Capacity enforcement: only when assigning TO a vehicle (not unassign)
if targetVehicle ~= 'UNASSIGNED' then
  local orderJson   = redis.call('HGET', ordersHash, orderId)
  local vehicleJson = redis.call('HGET', vehiclesHash, targetVehicle)
  local orderWeight   = cjson.decode(orderJson)['weight_kg'] or 0
  local vehicleCap    = cjson.decode(vehicleJson)['capacity_kg'] or 0

  -- Sum weights of orders already on this vehicle's route
  local routeKey = routePrefix .. targetVehicle
  local currentRoute = redis.call('LRANGE', routeKey, 0, -1)
  local currentLoad = 0
  for _, oid in ipairs(currentRoute) do
    if oid ~= orderId then  -- skip if order is being reassigned (already on route)
      local oj = redis.call('HGET', ordersHash, oid)
      if oj then
        currentLoad = currentLoad + (cjson.decode(oj)['weight_kg'] or 0)
      end
    end
  end

  if currentLoad + orderWeight > vehicleCap then
    return -4  -- CAPACITY_EXCEEDED
  end
end

local current = redis.call('HGET', orderToVehicle, orderId)
if current and current ~= 'UNASSIGNED' then
  redis.call('LREM', routePrefix .. current, 0, orderId)
else
  redis.call('SREM', unassigned, orderId)
end

if targetVehicle == 'UNASSIGNED' then
  redis.call('SADD', unassigned, orderId)
  redis.call('HSET', orderToVehicle, orderId, 'UNASSIGNED')
else
  local routeKey = routePrefix .. targetVehicle
  if position < 0 then
    redis.call('RPUSH', routeKey, orderId)
  else
    local route = redis.call('LRANGE', routeKey, 0, -1)
    redis.call('DEL', routeKey)
    local inserted = false
    for i, id in ipairs(route) do
      if (i - 1) == position and not inserted then
        redis.call('RPUSH', routeKey, orderId)
        inserted = true
      end
      redis.call('RPUSH', routeKey, id)
    end
    if not inserted then
      redis.call('RPUSH', routeKey, orderId)
    end
  end
  redis.call('HSET', orderToVehicle, orderId, targetVehicle)
end

return redis.call('INCR', revKey)
`;

/* ------------------------------------------------------------------ */
/*  DELETE VEHICLE                                                     */
/*  Moves all route orders to unassigned, removes vehicle.             */
/*                                                                     */
/*  KEYS[1] = vehicles   KEYS[2] = orderToVehicle                     */
/*  KEYS[3] = unassigned KEYS[4] = rev                                */
/*  ARGV[1] = vehicleId  ARGV[2] = route key                          */
/*  ARGV[3] = baseRev (-1=skip)                                       */
/*  Returns: { csv_of_order_ids, new_rev | error_code }               */
/* ------------------------------------------------------------------ */
export const DELETE_VEHICLE = `
local vehiclesHash   = KEYS[1]
local orderToVehicle = KEYS[2]
local unassigned     = KEYS[3]
local revKey         = KEYS[4]

local vehicleId = ARGV[1]
local routeKey  = ARGV[2]
local baseRev   = tonumber(ARGV[3])

if baseRev >= 0 then
  local currentRev = tonumber(redis.call('GET', revKey)) or 0
  if baseRev ~= currentRev then
    return {'', -3}
  end
end

if redis.call('HEXISTS', vehiclesHash, vehicleId) == 0 then
  return {'', -2}
end

local orders = redis.call('LRANGE', routeKey, 0, -1)
for _, oid in ipairs(orders) do
  redis.call('SADD', unassigned, oid)
  redis.call('HSET', orderToVehicle, oid, 'UNASSIGNED')
end

redis.call('DEL', routeKey)
redis.call('HDEL', vehiclesHash, vehicleId)

local newRev = redis.call('INCR', revKey)
return { table.concat(orders, ','), newRev }
`;

/* ------------------------------------------------------------------ */
/*  DELETE ORDER                                                       */
/*  Removes order from wherever it lives (route or unassigned).        */
/*                                                                     */
/*  KEYS[1] = orders   KEYS[2] = orderToVehicle                       */
/*  KEYS[3] = unassigned KEYS[4] = rev                                */
/*  ARGV[1] = orderId  ARGV[2] = route key prefix                     */
/*  ARGV[3] = baseRev (-1=skip)                                       */
/* ------------------------------------------------------------------ */
export const DELETE_ORDER = `
local ordersHash     = KEYS[1]
local orderToVehicle = KEYS[2]
local unassigned     = KEYS[3]
local revKey         = KEYS[4]

local orderId     = ARGV[1]
local routePrefix = ARGV[2]
local baseRev     = tonumber(ARGV[3])

${OCC_CHECK}

if redis.call('HEXISTS', ordersHash, orderId) == 0 then
  return -1
end

local current = redis.call('HGET', orderToVehicle, orderId)
if current and current ~= 'UNASSIGNED' then
  redis.call('LREM', routePrefix .. current, 0, orderId)
else
  redis.call('SREM', unassigned, orderId)
end

redis.call('HDEL', orderToVehicle, orderId)
redis.call('HDEL', ordersHash, orderId)

return redis.call('INCR', revKey)
`;

/* ------------------------------------------------------------------ */
/*  UPDATE ROUTE                                                       */
/*  Replaces a vehicle's route atomically (optimization result).       */
/*  Reconciles orderToVehicle + unassigned so state stays consistent.  */
/*                                                                     */
/*  KEYS[1] = rev           KEYS[2] = orderToVehicle                  */
/*  KEYS[3] = unassigned    KEYS[4] = orders                          */
/*  KEYS[5] = vehicles                                                 */
/*  ARGV[1] = route key     ARGV[2] = vehicleId                       */
/*  ARGV[3] = baseRev (-1=skip)                                       */
/*  ARGV[4..n] = ordered order IDs (desired new route)                 */
/* ------------------------------------------------------------------ */
export const UPDATE_ROUTE = `
local revKey         = KEYS[1]
local orderToVehicle = KEYS[2]
local unassigned     = KEYS[3]
local ordersHash     = KEYS[4]
local vehiclesHash   = KEYS[5]

local routeKey  = ARGV[1]
local vehicleId = ARGV[2]
local baseRev   = tonumber(ARGV[3])

${OCC_CHECK}

-- Abort if the vehicle was deleted during optimization
if redis.call('HEXISTS', vehiclesHash, vehicleId) == 0 then
  return -2
end

-- Snapshot the old route (before mutation) for new-arrival detection
local oldRoute = redis.call('LRANGE', routeKey, 0, -1)

-- Build the validated new route: only keep orders that
--  (a) still exist in the orders hash, AND
--  (b) are still assigned to THIS vehicle (not moved by a dispatcher)
local validRoute = {}
local newSet = {}
for i = 4, #ARGV do
  local oid = ARGV[i]
  if redis.call('HEXISTS', ordersHash, oid) == 1 then
    local owner = redis.call('HGET', orderToVehicle, oid)
    if owner == vehicleId then
      table.insert(validRoute, oid)
      newSet[oid] = true
    end
    -- If owner ~= vehicleId, the order was reassigned → skip silently
  end
  -- If order doesn't exist, it was deleted → skip silently
end

-- Preserve "new arrivals": orders on the current route that are NOT
-- in the optimization result. These were added by the dispatcher after
-- optimization started. Append them at the end (dispatcher always wins).
-- Duplicate guard: skip orders already in newSet.
for _, oid in ipairs(oldRoute) do
  if not newSet[oid] then
    if redis.call('HEXISTS', ordersHash, oid) == 1 then
      local owner = redis.call('HGET', orderToVehicle, oid)
      if owner == vehicleId then
        table.insert(validRoute, oid)
        newSet[oid] = true
      end
    end
  end
end

-- Capacity enforcement: verify the validated route does not exceed vehicle capacity
-- BEFORE mutating Redis state. If this fails, we must not partially apply route changes.
local vehicleRaw = redis.call('HGET', vehiclesHash, vehicleId)
if vehicleRaw then
  local vehicleCap = cjson.decode(vehicleRaw)['capacity_kg'] or 0
  local totalLoad = 0
  for _, oid in ipairs(validRoute) do
    local oj = redis.call('HGET', ordersHash, oid)
    if oj then
      totalLoad = totalLoad + (cjson.decode(oj)['weight_kg'] or 0)
    end
  end
  if totalLoad > vehicleCap then
    return -4  -- CAPACITY_EXCEEDED
  end
end

-- Apply the validated route atomically (only after all guards pass)
redis.call('DEL', routeKey)
for _, oid in ipairs(validRoute) do
  redis.call('RPUSH', routeKey, oid)
end

return redis.call('INCR', revKey)
`;

/* ------------------------------------------------------------------ */
/*  SET ORDER (upsert)                                                 */
/*  If order is new, also adds to unassigned pool.                     */
/*  If order is assigned, rechecks vehicle capacity with new weight.    */
/*                                                                     */
/*  KEYS[1] = orders   KEYS[2] = unassigned                           */
/*  KEYS[3] = orderToVehicle  KEYS[4] = rev                           */
/*  KEYS[5] = vehicles                                                 */
/*  ARGV[1] = orderId  ARGV[2] = orderJSON                            */
/*  ARGV[3] = baseRev (-1=skip)  ARGV[4] = route key prefix           */
/* ------------------------------------------------------------------ */
export const SET_ORDER = `
local ordersHash     = KEYS[1]
local unassigned     = KEYS[2]
local orderToVehicle = KEYS[3]
local revKey         = KEYS[4]
local vehiclesHash   = KEYS[5]

local orderId      = ARGV[1]
local orderJson    = ARGV[2]
local baseRev      = tonumber(ARGV[3])
local routePrefix  = ARGV[4]

${OCC_CHECK}

local exists = redis.call('HEXISTS', ordersHash, orderId)

-- Capacity recheck: if the order is already assigned to a vehicle,
-- verify that the new weight does not overload the vehicle.
if exists == 1 then
  local owner = redis.call('HGET', orderToVehicle, orderId)
  if owner and owner ~= 'UNASSIGNED' then
    local vehicleRaw = redis.call('HGET', vehiclesHash, owner)
    if vehicleRaw then
      local newWeight   = cjson.decode(orderJson)['weight_kg'] or 0
      local vehicleCap  = cjson.decode(vehicleRaw)['capacity_kg'] or 0

      -- Sum route load, substituting new weight for this order
      local routeKey = routePrefix .. owner
      local currentRoute = redis.call('LRANGE', routeKey, 0, -1)
      local load = 0
      for _, oid in ipairs(currentRoute) do
        if oid == orderId then
          load = load + newWeight  -- use new weight
        else
          local oj = redis.call('HGET', ordersHash, oid)
          if oj then
            load = load + (cjson.decode(oj)['weight_kg'] or 0)
          end
        end
      end

      if load > vehicleCap then
        return -4  -- CAPACITY_EXCEEDED
      end
    end
  end
end

redis.call('HSET', ordersHash, orderId, orderJson)

if exists == 0 then
  redis.call('SADD', unassigned, orderId)
  redis.call('HSET', orderToVehicle, orderId, 'UNASSIGNED')
end

return redis.call('INCR', revKey)
`;

/* ------------------------------------------------------------------ */
/*  SET VEHICLE (upsert)                                               */
/*  Atomic vehicle create/update with OCC support.                     */
/*  If capacity_kg is reduced, rechecks existing route load.           */
/*                                                                     */
/*  KEYS[1] = vehicles  KEYS[2] = rev                                 */
/*  KEYS[3] = orders    KEYS[4] = orderToVehicle                       */
/*  ARGV[1] = vehicleId ARGV[2] = vehicleJSON                         */
/*  ARGV[3] = baseRev (-1=skip)  ARGV[4] = route key prefix           */
/* ------------------------------------------------------------------ */
export const SET_VEHICLE = `
local vehiclesHash   = KEYS[1]
local revKey         = KEYS[2]
local ordersHash     = KEYS[3]
local orderToVehicle = KEYS[4]

local vehicleId   = ARGV[1]
local vehicleJson = ARGV[2]
local baseRev     = tonumber(ARGV[3])
local routePrefix = ARGV[4]

${OCC_CHECK}

-- Capacity downsize check: if vehicle already exists, verify that
-- the new capacity still accommodates the current route load.
local exists = redis.call('HEXISTS', vehiclesHash, vehicleId)
if exists == 1 then
  local newCap = cjson.decode(vehicleJson)['capacity_kg'] or 0
  local routeKey = routePrefix .. vehicleId
  local currentRoute = redis.call('LRANGE', routeKey, 0, -1)
  local currentLoad = 0
  for _, oid in ipairs(currentRoute) do
    local oj = redis.call('HGET', ordersHash, oid)
    if oj then
      currentLoad = currentLoad + (cjson.decode(oj)['weight_kg'] or 0)
    end
  end
  if currentLoad > newCap then
    return -4  -- CAPACITY_EXCEEDED
  end
end

redis.call('HSET', vehiclesHash, vehicleId, vehicleJson)
return redis.call('INCR', revKey)
`;

/* ------------------------------------------------------------------ */
/*  Script registry (name -> body) used by LuaScriptManager            */
/* ------------------------------------------------------------------ */

export const LUA_SCRIPTS = {
  assignOrder: ASSIGN_ORDER,
  deleteVehicle: DELETE_VEHICLE,
  deleteOrder: DELETE_ORDER,
  updateRoute: UPDATE_ROUTE,
  setOrder: SET_ORDER,
  setVehicle: SET_VEHICLE,
} as const;
