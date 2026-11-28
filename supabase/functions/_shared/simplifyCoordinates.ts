export type Coordinate = [number, number] | [number, number, number];

// Coordinates and tolerances are in degrees. At the equator these are at most
// about 22 m, 2.2 m, and 0.6 m respectively; longitude errors decrease poleward.
export const geometryTolerances = { low: 0.0002, medium: 0.00002, high: 0.000005 };

function segmentDistance(point: Coordinate, start: Coordinate, end: Coordinate) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
  return Math.hypot(point[0] - start[0] - t * dx, point[1] - start[1] - t * dy);
}

// Iterative Douglas-Peucker keeps endpoints, loop corners, and altitude values
// without overflowing the call stack on long GPS streams.
export function simplifyCoordinates(coordinates: Coordinate[], tolerance: number): Coordinate[] {
  if (coordinates.length <= 2) return coordinates;
  const keep = new Set([0, coordinates.length - 1]);
  const pending: [number, number][] = [[0, coordinates.length - 1]];
  while (pending.length) {
    const [start, end] = pending.pop()!;
    let farthest = -1;
    let distance = tolerance;
    for (let index = start + 1; index < end; index++) {
      const candidate = segmentDistance(coordinates[index], coordinates[start], coordinates[end]);
      if (candidate > distance) { distance = candidate; farthest = index; }
    }
    if (farthest !== -1) {
      keep.add(farthest);
      pending.push([start, farthest], [farthest, end]);
    }
  }
  return coordinates.filter((_, index) => keep.has(index));
}
