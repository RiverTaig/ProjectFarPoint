// GENERATED: paste this entire file into the submit-offline-activity Edge Function editor.
// Do not paste into SQL Editor. Regenerate with node scripts/prepare-offline-function.mjs.
// @ts-nocheck -- generated JavaScript in a .ts dashboard entrypoint; source is typechecked separately.

// supabase/functions/submit-offline-activity/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";

// supabase/functions/_shared/trailExtraction.ts
var TrailError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
var radius = 63710088e-1;
var radians = (n) => n * Math.PI / 180;
var degrees = (n) => n * 180 / Math.PI;
function distanceMeters(a, b) {
  const h = Math.sin(radians(b[1] - a[1]) / 2) ** 2 + Math.cos(radians(a[1])) * Math.cos(radians(b[1])) * Math.sin(radians(b[0] - a[0]) / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}
function bearing(a, b) {
  const delta = radians(b[0] - a[0]);
  return Math.atan2(
    Math.sin(delta) * Math.cos(radians(b[1])),
    Math.cos(radians(a[1])) * Math.sin(radians(b[1])) - Math.sin(radians(a[1])) * Math.cos(radians(b[1])) * Math.cos(delta)
  );
}
function interpolate(a, b, fraction) {
  if (fraction <= 0) return [...a];
  if (fraction >= 1) return [...b];
  const angle = distanceMeters(a, b) / radius;
  if (angle < 1e-12) return [...a];
  const first = Math.sin((1 - fraction) * angle) / Math.sin(angle);
  const second = Math.sin(fraction * angle) / Math.sin(angle);
  const x = first * Math.cos(radians(a[1])) * Math.cos(radians(a[0])) + second * Math.cos(radians(b[1])) * Math.cos(radians(b[0]));
  const y = first * Math.cos(radians(a[1])) * Math.sin(radians(a[0])) + second * Math.cos(radians(b[1])) * Math.sin(radians(b[0]));
  const z = first * Math.sin(radians(a[1])) + second * Math.sin(radians(b[1]));
  return [degrees(Math.atan2(y, x)), degrees(Math.atan2(z, Math.hypot(x, y)))];
}
function nearestOnSegment(point, a, b) {
  const length = distanceMeters(a, b);
  const angle = distanceMeters(a, point) / radius;
  const along = Math.atan2(Math.sin(angle) * Math.cos(bearing(a, point) - bearing(a, b)), Math.cos(angle)) * radius;
  const offset = Math.max(0, Math.min(length, along));
  const coordinate = interpolate(a, b, length ? offset / length : 0);
  return { coordinate, offset, distanceMeters: distanceMeters(point, coordinate) };
}
function validCoordinate(value) {
  return Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
}
var key = (point) => `${point[0]},${point[1]}`;
function buildTrailIndex(input) {
  const feature = input;
  const geometry = feature?.type === "Feature" ? feature.geometry : feature;
  const raw = geometry;
  const lines = raw?.type === "LineString" ? [raw.coordinates] : raw?.type === "MultiLineString" && Array.isArray(raw.coordinates) ? raw.coordinates : null;
  if (!lines?.length) throw new TrailError("INVALID_TRAIL", "Expected a trail LineString or MultiLineString.");
  const sections = lines.map((line) => {
    if (!Array.isArray(line) || line.length < 2 || !line.every(validCoordinate)) {
      throw new TrailError("INVALID_TRAIL", "Trail contains an invalid section or coordinate.");
    }
    return line.map((p) => [p[0], p[1]]);
  });
  const nodes = /* @__PURE__ */ new Map();
  sections.forEach((line, id) => {
    for (const point of [line[0], line[line.length - 1]]) {
      const ids = nodes.get(key(point)) ?? [];
      ids.push(id);
      nodes.set(key(point), ids);
    }
  });
  const visited = /* @__PURE__ */ new Set();
  const chains = [];
  for (let seed = 0; seed < sections.length; seed++) {
    if (visited.has(seed)) continue;
    const component = /* @__PURE__ */ new Set();
    const pending = [seed];
    while (pending.length) {
      const id = pending.pop();
      if (component.has(id)) continue;
      component.add(id);
      const line = sections[id];
      for (const point2 of [line[0], line[line.length - 1]]) {
        const neighbors = nodes.get(key(point2));
        if (neighbors.length > 2) throw new TrailError("AMBIGUOUS_TRAIL", "Trail branches at a section endpoint; review its routing before extraction.");
        for (const neighbor of neighbors) if (!component.has(neighbor)) pending.push(neighbor);
      }
    }
    const ends = [...component].flatMap((id) => {
      const line = sections[id];
      return [line[0], line[line.length - 1]].filter((p) => nodes.get(key(p)).length === 1);
    });
    if (ends.length !== 2) throw new TrailError("AMBIGUOUS_TRAIL", "Closed or ambiguous trail chain requires explicit routing.");
    let point = ends[0];
    const coordinates = [];
    const sectionIds = [];
    while (true) {
      const id = nodes.get(key(point)).find((candidate) => !visited.has(candidate));
      if (id === void 0) break;
      visited.add(id);
      sectionIds.push(id + 1);
      const section = sections[id];
      const oriented = key(section[0]) === key(point) ? section : [...section].reverse();
      coordinates.push(...coordinates.length ? oriented.slice(1) : oriented);
      point = oriented[oriented.length - 1];
    }
    const distances = [0];
    for (let i = 1; i < coordinates.length; i++) distances.push(distances[i - 1] + distanceMeters(coordinates[i - 1], coordinates[i]));
    chains.push({ coordinates, distances, sectionIds });
  }
  return { chains };
}
function snapToTrail(index, point, tolerance = 100) {
  if (!validCoordinate(point) || !Number.isFinite(tolerance) || tolerance <= 0) throw new TrailError("INVALID_POINT", "Invalid coordinate or snapping tolerance.");
  const candidates = [];
  index.chains.forEach((chain, chainId) => {
    for (let i = 1; i < chain.coordinates.length; i++) {
      const snap = nearestOnSegment(point, chain.coordinates[i - 1], chain.coordinates[i]);
      candidates.push({
        coordinate: snap.coordinate,
        distanceMeters: snap.distanceMeters,
        alongMeters: chain.distances[i - 1] + snap.offset,
        chain: chainId
      });
    }
  });
  candidates.sort((a, b) => a.distanceMeters - b.distanceMeters);
  const best = candidates[0];
  if (!best || best.distanceMeters > tolerance) throw new TrailError(
    "OFF_TRAIL",
    `Point ${point.join(",")} is ${best ? best.distanceMeters.toFixed(1) : "unknown"} meters from the trail; maximum is ${tolerance} meters.`
  );
  if (candidates.some((other) => other.distanceMeters <= best.distanceMeters + 1 && (other.chain !== best.chain || Math.abs(other.alongMeters - best.alongMeters) > 20))) {
    throw new TrailError("AMBIGUOUS_SNAP", "Point is equally close to different trail positions; use a more specific coordinate.");
  }
  return best;
}
function extractTrailSection(index, start, end, tolerance = 100) {
  const snappedStart = snapToTrail(index, start, tolerance);
  const snappedEnd = snapToTrail(index, end, tolerance);
  if (snappedStart.chain !== snappedEnd.chain) throw new TrailError("TRAIL_GAP", "Start and end are on disconnected trail chains. Send separate reports on each side of the transfer.");
  if (Math.abs(snappedEnd.alongMeters - snappedStart.alongMeters) < 0.01) throw new TrailError("EMPTY_SECTION", "Start and end resolve to the same trail position.");
  const chain = index.chains[snappedStart.chain];
  const reverse = snappedStart.alongMeters > snappedEnd.alongMeters;
  const low = reverse ? snappedEnd : snappedStart;
  const high = reverse ? snappedStart : snappedEnd;
  const coordinates = [low.coordinate];
  chain.coordinates.forEach((p, i) => {
    if (chain.distances[i] > low.alongMeters + 1e-6 && chain.distances[i] < high.alongMeters - 1e-6) coordinates.push(p);
  });
  coordinates.push(high.coordinate);
  if (reverse) coordinates.reverse();
  const meters = coordinates.slice(1).reduce((sum, p, i) => sum + distanceMeters(coordinates[i], p), 0);
  return {
    geometry: { type: "LineString", coordinates },
    distanceMeters: meters,
    snappedStart,
    snappedEnd,
    reversedFromChain: reverse,
    chain: snappedStart.chain + 1
  };
}
function parseOfflineUrl(value, registeredTrail = { code: "TA", timezone: "Pacific/Auckland" }) {
  const url = new URL(value, "https://projectfarpoint.com");
  const values = ["t", "p", "dt", "s", "e"].map((name) => {
    const all = url.searchParams.getAll(name);
    if (all.length !== 1 || !all[0]) throw new TrailError("INVALID_URL", `Supply exactly one ${name} parameter.`);
    return all[0];
  });
  const [trail, path, localDateTime, startText, endText] = values;
  if (trail !== registeredTrail.code) throw new TrailError("UNKNOWN_TRAIL", `Trail ${trail} is not registered for this request.`);
  if (path !== "V" && path !== "F") throw new TrailError("INVALID_PATH", "Use p=V for Voyager or p=F for Far Point Trail.");
  if (!/^\d{8}T\d{4}$/.test(localDateTime)) throw new TrailError("INVALID_TIME", "Use dt=YYYYMMDDTHHMM in the trail local timezone.");
  const [year, month, day, hour, minute] = [localDateTime.slice(0, 4), localDateTime.slice(4, 6), localDateTime.slice(6, 8), localDateTime.slice(9, 11), localDateTime.slice(11, 13)].map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (year < 2e3 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute) {
    throw new TrailError("INVALID_TIME", "Hike date/time is not a valid calendar date/time.");
  }
  const coordinate = (text) => {
    if (!/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(text)) throw new TrailError("INVALID_POINT", "Coordinates must be longitude,latitude decimal numbers.");
    const parts = text.split(",").map(Number);
    if (!validCoordinate(parts)) throw new TrailError("INVALID_POINT", "Longitude or latitude is outside WGS84 limits.");
    return parts;
  };
  return {
    trail,
    appliesTo: path === "V" ? "Voyager" : "Far Point Trail",
    localDateTime,
    timezone: registeredTrail.timezone,
    start: coordinate(startText),
    end: coordinate(endText)
  };
}

// supabase/functions/_shared/offlineSubmission.ts
function resolveLocalDateTime(local, timezone) {
  const parts = [local.slice(0, 4), local.slice(4, 6), local.slice(6, 8), local.slice(9, 11), local.slice(11, 13)].map(Number);
  const naive = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4]);
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const localMillis = (instant) => {
    const fields = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
    return Date.UTC(
      Number(fields.year),
      Number(fields.month) - 1,
      Number(fields.day),
      Number(fields.hour),
      Number(fields.minute),
      Number(fields.second)
    );
  };
  const offsets = /* @__PURE__ */ new Set();
  for (let hours = -36; hours <= 36; hours += 6) {
    const instant = naive + hours * 36e5;
    offsets.add(localMillis(instant) - instant);
  }
  const candidates = [...offsets].map((offset) => naive - offset).filter((instant) => localMillis(instant) === naive);
  if (candidates.length !== 1) throw new TrailError("INVALID_LOCAL_TIME", candidates.length ? "Hike time falls in a repeated daylight-saving hour. Choose an unambiguous local time." : "Hike time does not exist due to a daylight-saving clock change. Correct dt.");
  return new Date(candidates[0]).toISOString();
}
async function passwordMatches(supplied, expected) {
  if (typeof supplied !== "string") return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([supplied, expected].map(async (value) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))));
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
async function readRequestBytes(request, limit) {
  const reader = request.body?.getReader();
  if (!reader) throw new TrailError("INVALID_BODY", "A request body is required.");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new TrailError("INVALID_BODY", `Request exceeds ${limit} bytes.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
async function readBody(request, limit = 4096) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new TrailError("INVALID_BODY", "Send application/json with t, p, dt, s, e, and pw.");
  }
  const bytes = await readRequestBytes(request, limit);
  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new TrailError("INVALID_BODY", "Request body is not valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new TrailError("INVALID_BODY", "Request body must be a JSON object.");
  return body;
}
function createOfflineHandler(dependencies) {
  return async (request) => {
    const origin = request.headers.get("origin");
    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      Vary: "Origin",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type"
    };
    const json = (value, status = 200) => new Response(JSON.stringify(value, null, 2), { status, headers });
    if (origin && !dependencies.allowedOrigins().includes(origin)) return json({ status: "failed", code: "ORIGIN_NOT_ALLOWED", error: "Origin is not allowed." }, 403);
    if (origin) headers["Access-Control-Allow-Origin"] = origin;
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") {
      headers.Allow = "POST, OPTIONS";
      return json({ status: "failed", code: "METHOD_NOT_ALLOWED", error: "Use an explicit POST submission; opening a link never creates an activity." }, 405);
    }
    const config = dependencies.config();
    if (!config?.password || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(config.ownerId)) {
      return json({ status: "failed", code: "NOT_CONFIGURED", error: "Offline submission is not configured." }, 503);
    }
    let store;
    let claimed;
    try {
      const body = await readBody(request);
      if (!await passwordMatches(body.pw, config.password)) return json({ status: "failed", code: "UNAUTHORIZED", error: "Incorrect or missing submission password." }, 401);
      const url = new URL("https://projectfarpoint.com/offline");
      for (const field of ["t", "p", "dt", "s", "e"]) {
        if (typeof body[field] !== "string" || !body[field] || body[field].length > 100) throw new TrailError("INVALID_URL", `Supply a valid ${field} string.`);
        url.searchParams.set(field, body[field]);
      }
      if (!/^[A-Z][A-Z0-9]{0,15}$/.test(body.t)) throw new TrailError("UNKNOWN_TRAIL", "Unknown trail code.");
      const preliminary = parseOfflineUrl(url.href, { code: body.t, timezone: "UTC" });
      store = dependencies.store();
      const trail = await store.trail(preliminary.trail);
      if (!trail) throw new TrailError("UNKNOWN_TRAIL", "No published geometry is registered for this trail.");
      const input = { ...preliminary, timezone: trail.timezone };
      const startedAt = resolveLocalDateTime(input.localDateTime, trail.timezone);
      const prepared = await store.prepare(config.ownerId, trail, input, startedAt);
      if (prepared.state === "completed") return json(prepared.result);
      if (prepared.state === "processing") {
        headers["Retry-After"] = "5";
        return json({
          status: "processing",
          requestId: prepared.requestId,
          retryAfterSeconds: 5,
          message: "This request is already processing. Resubmit the same parameters shortly to retrieve its result."
        }, 202);
      }
      claimed = prepared.request;
      const geometry = await store.geometry(claimed.trail_version_id);
      const section = extractTrailSection(buildTrailIndex(geometry), input.start, input.end, Number(trail.snap_tolerance_meters));
      const result = await store.complete(claimed, section);
      return json(result);
    } catch (error) {
      const code = error instanceof TrailError ? error.code : "PROCESSING_FAILED";
      const message = error instanceof TrailError ? error.message : "Could not finish processing. Resubmit the same request to retry.";
      if (store && claimed) {
        try {
          await store.fail(claimed, code, message);
        } catch {
        }
      }
      return json({ status: "failed", code, error: message, ...claimed ? { requestId: claimed.id } : {} }, error instanceof TrailError ? 422 : 500);
    }
  };
}

// supabase/functions/submit-offline-activity/index.ts
var handler = createOfflineHandler({
  config: () => {
    const password = Deno.env.get("OFFLINE_SUBMISSION_PASSWORD");
    const ownerId = Deno.env.get("OFFLINE_ACTIVITY_OWNER_ID");
    return password && ownerId ? { password, ownerId } : null;
  },
  allowedOrigins: () => (Deno.env.get("APP_ORIGINS") ?? "https://projectfarpoint.com").split(",").map((value) => value.trim()).filter(Boolean),
  store: () => {
    const url = Deno.env.get("SUPABASE_URL");
    const key2 = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key2) throw new Error("Server database configuration missing.");
    const client = createClient(url, key2, { auth: { persistSession: false, autoRefreshToken: false } });
    return {
      async trail(code) {
        const { data, error } = await client.from("trails").select("id,code,timezone,snap_tolerance_meters,current_version_id").eq("code", code).maybeSingle();
        if (error) throw error;
        return data?.current_version_id ? data : null;
      },
      async prepare(ownerId, trail, input, startedAt) {
        const { data, error } = await client.rpc("pfp_prepare_offline_request", {
          p_owner: ownerId,
          p_trail: trail.id,
          p_path: input.appliesTo,
          p_local: input.localDateTime,
          p_started: startedAt,
          p_start_lon: input.start[0],
          p_start_lat: input.start[1],
          p_end_lon: input.end[0],
          p_end_lat: input.end[1]
        });
        if (error) throw error;
        return data;
      },
      async geometry(versionId) {
        const { data, error } = await client.from("trail_versions").select("geojson").eq("id", versionId).single();
        if (error) throw error;
        return data.geojson;
      },
      async complete(request, section) {
        const { data, error } = await client.rpc("pfp_complete_offline_request", {
          p_request: request.id,
          p_token: request.processing_token,
          p_geometry: section.geometry
        });
        if (error) throw error;
        return data;
      },
      async fail(request, code, message) {
        const { error } = await client.rpc("pfp_fail_offline_request", {
          p_request: request.id,
          p_token: request.processing_token,
          p_code: code,
          p_message: message
        });
        if (error) throw error;
      }
    };
  }
});
Deno.serve(handler);
