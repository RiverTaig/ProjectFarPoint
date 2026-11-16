export type Coordinate = [number, number];
export type TrailChain = { coordinates: Coordinate[]; distances: number[]; sectionIds: number[] };
export type TrailIndex = { chains: TrailChain[] };
export type Snap = { coordinate: Coordinate; distanceMeters: number; alongMeters: number; chain: number };
export class TrailError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
const radius = 6371008.8;
const radians = (n: number) => n * Math.PI / 180;
const degrees = (n: number) => n * 180 / Math.PI;

export function distanceMeters(a: Coordinate, b: Coordinate): number {
  const h = Math.sin(radians(b[1] - a[1]) / 2) ** 2
    + Math.cos(radians(a[1])) * Math.cos(radians(b[1])) * Math.sin(radians(b[0] - a[0]) / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}
function bearing(a: Coordinate, b: Coordinate): number {
  const delta = radians(b[0] - a[0]);
  return Math.atan2(Math.sin(delta) * Math.cos(radians(b[1])),
    Math.cos(radians(a[1])) * Math.sin(radians(b[1]))
    - Math.sin(radians(a[1])) * Math.cos(radians(b[1])) * Math.cos(delta));
}
function interpolate(a: Coordinate, b: Coordinate, fraction: number): Coordinate {
  if (fraction <= 0) return [...a];
  if (fraction >= 1) return [...b];
  const angle = distanceMeters(a, b) / radius;
  if (angle < 1e-12) return [...a];
  const first = Math.sin((1 - fraction) * angle) / Math.sin(angle);
  const second = Math.sin(fraction * angle) / Math.sin(angle);
  const x = first * Math.cos(radians(a[1])) * Math.cos(radians(a[0]))
    + second * Math.cos(radians(b[1])) * Math.cos(radians(b[0]));
  const y = first * Math.cos(radians(a[1])) * Math.sin(radians(a[0]))
    + second * Math.cos(radians(b[1])) * Math.sin(radians(b[0]));
  const z = first * Math.sin(radians(a[1])) + second * Math.sin(radians(b[1]));
  return [degrees(Math.atan2(y, x)), degrees(Math.atan2(z, Math.hypot(x, y)))];
}
function nearestOnSegment(point: Coordinate, a: Coordinate, b: Coordinate) {
  const length = distanceMeters(a, b);
  const angle = distanceMeters(a, point) / radius;
  const along = Math.atan2(Math.sin(angle) * Math.cos(bearing(a, point) - bearing(a, b)), Math.cos(angle)) * radius;
  const offset = Math.max(0, Math.min(length, along));
  const coordinate = interpolate(a, b, length ? offset / length : 0);
  return { coordinate, offset, distanceMeters: distanceMeters(point, coordinate) };
}
function validCoordinate(value: unknown): value is Coordinate {
  return Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0])
    && Number.isFinite(value[1]) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
}
const key = (point: Coordinate) => `${point[0]},${point[1]}`;

// Only explicit equal endpoints connect sections. A crossing or a nearby road
// is not evidence of connectivity; the 100 m snapping limit never joins chains.
export function buildTrailIndex(input: unknown): TrailIndex {
  const feature = input as { type?: string; geometry?: { type?: string; coordinates?: unknown } };
  const geometry = feature?.type === 'Feature' ? feature.geometry : feature;
  const raw = geometry as { type?: string; coordinates?: unknown } | undefined;
  const lines = raw?.type === 'LineString' ? [raw.coordinates]
    : raw?.type === 'MultiLineString' && Array.isArray(raw.coordinates) ? raw.coordinates : null;
  if (!lines?.length) throw new TrailError('INVALID_TRAIL', 'Expected a trail LineString or MultiLineString.');
  const sections: Coordinate[][] = lines.map((line) => {
    if (!Array.isArray(line) || line.length < 2 || !line.every(validCoordinate)) {
      throw new TrailError('INVALID_TRAIL', 'Trail contains an invalid section or coordinate.');
    }
    return line.map((p) => [p[0], p[1]]);
  });
  const nodes = new Map<string, number[]>();
  sections.forEach((line, id) => {
    for (const point of [line[0], line[line.length - 1]]) {
      const ids = nodes.get(key(point)) ?? []; ids.push(id); nodes.set(key(point), ids);
    }
  });
  const visited = new Set<number>();
  const chains: TrailChain[] = [];
  for (let seed = 0; seed < sections.length; seed++) {
    if (visited.has(seed)) continue;
    const component = new Set<number>();
    const pending = [seed];
    while (pending.length) {
      const id = pending.pop()!;
      if (component.has(id)) continue;
      component.add(id);
      const line = sections[id];
      for (const point of [line[0], line[line.length - 1]]) {
        const neighbors = nodes.get(key(point))!;
        if (neighbors.length > 2) throw new TrailError('AMBIGUOUS_TRAIL', 'Trail branches at a section endpoint; review its routing before extraction.');
        for (const neighbor of neighbors) if (!component.has(neighbor)) pending.push(neighbor);
      }
    }
    const ends = [...component].flatMap((id) => {
      const line = sections[id];
      return [line[0], line[line.length - 1]].filter((p) => nodes.get(key(p))!.length === 1);
    });
    if (ends.length !== 2) throw new TrailError('AMBIGUOUS_TRAIL', 'Closed or ambiguous trail chain requires explicit routing.');
    let point = ends[0];
    const coordinates: Coordinate[] = [];
    const sectionIds: number[] = [];
    while (true) {
      const id = nodes.get(key(point))!.find((candidate) => !visited.has(candidate));
      if (id === undefined) break;
      visited.add(id); sectionIds.push(id + 1);
      const section = sections[id];
      const oriented = key(section[0]) === key(point) ? section : [...section].reverse();
      coordinates.push(...(coordinates.length ? oriented.slice(1) : oriented));
      point = oriented[oriented.length - 1];
    }
    const distances = [0];
    for (let i = 1; i < coordinates.length; i++) distances.push(distances[i - 1] + distanceMeters(coordinates[i - 1], coordinates[i]));
    chains.push({ coordinates, distances, sectionIds });
  }
  return { chains };
}

export function snapToTrail(index: TrailIndex, point: Coordinate, tolerance = 100): Snap {
  if (!validCoordinate(point) || !Number.isFinite(tolerance) || tolerance <= 0) throw new TrailError('INVALID_POINT', 'Invalid coordinate or snapping tolerance.');
  const candidates: Snap[] = [];
  index.chains.forEach((chain, chainId) => {
    for (let i = 1; i < chain.coordinates.length; i++) {
      const snap = nearestOnSegment(point, chain.coordinates[i - 1], chain.coordinates[i]);
      candidates.push({ coordinate: snap.coordinate, distanceMeters: snap.distanceMeters,
        alongMeters: chain.distances[i - 1] + snap.offset, chain: chainId });
    }
  });
  candidates.sort((a, b) => a.distanceMeters - b.distanceMeters);
  const best = candidates[0];
  if (!best || best.distanceMeters > tolerance) throw new TrailError('OFF_TRAIL',
    `Point ${point.join(',')} is ${best ? best.distanceMeters.toFixed(1) : 'unknown'} meters from the trail; maximum is ${tolerance} meters.`);
  // Adjacent segments describe the same position. Distant positions that are
  // equally close (within 1 m) need clarification rather than an arbitrary pick.
  if (candidates.some((other) => other.distanceMeters <= best.distanceMeters + 1
    && (other.chain !== best.chain || Math.abs(other.alongMeters - best.alongMeters) > 20))) {
    throw new TrailError('AMBIGUOUS_SNAP', 'Point is equally close to different trail positions; use a more specific coordinate.');
  }
  return best;
}

export function extractTrailSection(index: TrailIndex, start: Coordinate, end: Coordinate, tolerance = 100) {
  const snappedStart = snapToTrail(index, start, tolerance);
  const snappedEnd = snapToTrail(index, end, tolerance);
  if (snappedStart.chain !== snappedEnd.chain) throw new TrailError('TRAIL_GAP', 'Start and end are on disconnected trail chains. Send separate reports on each side of the transfer.');
  if (Math.abs(snappedEnd.alongMeters - snappedStart.alongMeters) < 0.01) throw new TrailError('EMPTY_SECTION', 'Start and end resolve to the same trail position.');
  const chain = index.chains[snappedStart.chain];
  const reverse = snappedStart.alongMeters > snappedEnd.alongMeters;
  const low = reverse ? snappedEnd : snappedStart;
  const high = reverse ? snappedStart : snappedEnd;
  const coordinates: Coordinate[] = [low.coordinate];
  chain.coordinates.forEach((p, i) => {
    if (chain.distances[i] > low.alongMeters + 1e-6 && chain.distances[i] < high.alongMeters - 1e-6) coordinates.push(p);
  });
  coordinates.push(high.coordinate);
  if (reverse) coordinates.reverse();
  const meters = coordinates.slice(1).reduce((sum, p, i) => sum + distanceMeters(coordinates[i], p), 0);
  return { geometry: { type: 'LineString' as const, coordinates }, distanceMeters: meters,
    snappedStart, snappedEnd, reversedFromChain: reverse, chain: snappedStart.chain + 1 };
}

export function parseOfflineUrl(value: string, registeredTrail = { code: 'TA', timezone: 'Pacific/Auckland' }) {
  const url = new URL(value, 'https://projectfarpoint.com');
  const values = ['t', 'p', 'dt', 's', 'e'].map((name) => {
    const all = url.searchParams.getAll(name);
    if (all.length !== 1 || !all[0]) throw new TrailError('INVALID_URL', `Supply exactly one ${name} parameter.`);
    return all[0];
  });
  const [trail, path, localDateTime, startText, endText] = values;
  if (trail !== registeredTrail.code) throw new TrailError('UNKNOWN_TRAIL', `Trail ${trail} is not registered for this request.`);
  if (path !== 'V' && path !== 'F') throw new TrailError('INVALID_PATH', 'Use p=V for Voyager or p=F for Far Point Trail.');
  if (!/^\d{8}T\d{4}$/.test(localDateTime)) throw new TrailError('INVALID_TIME', 'Use dt=YYYYMMDDTHHMM in the trail local timezone.');
  const [year, month, day, hour, minute] = [localDateTime.slice(0, 4), localDateTime.slice(4, 6), localDateTime.slice(6, 8), localDateTime.slice(9, 11), localDateTime.slice(11, 13)].map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (year < 2000 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute) {
    throw new TrailError('INVALID_TIME', 'Hike date/time is not a valid calendar date/time.');
  }
  const coordinate = (text: string): Coordinate => {
    if (!/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(text)) throw new TrailError('INVALID_POINT', 'Coordinates must be longitude,latitude decimal numbers.');
    const parts = text.split(',').map(Number) as Coordinate;
    if (!validCoordinate(parts)) throw new TrailError('INVALID_POINT', 'Longitude or latitude is outside WGS84 limits.');
    return parts;
  };
  return { trail, appliesTo: path === 'V' ? 'Voyager' : 'Far Point Trail', localDateTime,
    timezone: registeredTrail.timezone, start: coordinate(startText), end: coordinate(endText) };
}
