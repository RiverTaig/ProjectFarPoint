import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTrailIndex, distanceMeters, extractTrailSection, parseOfflineUrl, snapToTrail } from '../src/offline/trailExtraction.ts';
import { previewExamples } from '../src/offline/previewExamples.ts';

const feature = JSON.parse(readFileSync(new URL('../public/TeAraroaTrail_2026_27.geojson', import.meta.url), 'utf8'));
const real = buildTrailIndex(feature);
const index = (lines) => buildTrailIndex({ type: 'MultiLineString', coordinates: lines });
const near = (a, b, tolerance = .01) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const fails = (fn, code) => assert.throws(fn, (error) => error.code === code);

test('sparse segment: interpolate interior endpoints and calculate arc distance', () => {
  const trail = index([[[0, 0], [1, 0]]]);
  const result = extractTrailSection(trail, [.2, 0], [.8, 0]);
  assert.equal(result.geometry.coordinates.length, 2);
  near(result.geometry.coordinates[0][0], .2, 1e-10);
  near(result.geometry.coordinates[1][0], .8, 1e-10);
  near(result.distanceMeters, 6371008.8 * Math.PI / 180 * .6);
});
test('100 meter limit applies to segment interior, not vertices', () => {
  const trail = index([[[0, 0], [1, 0]]]);
  const latitude = (meters) => meters / 6371008.8 * 180 / Math.PI;
  near(snapToTrail(trail, [.5, latitude(99.9)]).distanceMeters, 99.9);
  fails(() => snapToTrail(trail, [.5, latitude(100.1)]), 'OFF_TRAIL');
});
test('unordered and reversed sections connect by endpoints', () => {
  const trail = index([[[2, 0], [1, 0]], [[3, 0], [2, 0]], [[0, 0], [1, 0]]]);
  const result = extractTrailSection(trail, [.25, 0], [2.75, 0]);
  assert.equal(trail.chains.length, 1);
  assert.deepEqual(result.geometry.coordinates.slice(1, -1), [[1, 0], [2, 0]]);
  const reverse = extractTrailSection(trail, [2.75, 0], [.25, 0]);
  assert.deepEqual(reverse.geometry.coordinates, [...result.geometry.coordinates].reverse());
  near(reverse.distanceMeters, result.distanceMeters);
});
test('a gap is never bridged, even when less than 100 meters', () => {
  const trail = index([[[0, 0], [.01, 0]], [[.0105, 0], [.02, 0]]]);
  fails(() => extractTrailSection(trail, [0, 0], [.02, 0]), 'TRAIL_GAP');
});
test('ambiguous endpoint branches, closed loops, and equally near chains fail', () => {
  fails(() => index([[[0, 0], [1, 0]], [[1, 0], [2, 0]], [[1, 0], [1, 1]]]), 'AMBIGUOUS_TRAIL');
  fails(() => index([[[0, 0], [1, 0], [0, 0]]]), 'AMBIGUOUS_TRAIL');
  const trail = index([[[0, 0], [1, 0]], [[0, .00001], [1, .00001]]]);
  fails(() => snapToTrail(trail, [.5, .000005]), 'AMBIGUOUS_SNAP');
});
test('empty selections and malformed geometry fail', () => {
  fails(() => extractTrailSection(real, feature.geometry.coordinates[0][0], feature.geometry.coordinates[0][0]), 'EMPTY_SECTION');
  fails(() => index([[[0, 91], [1, 0]]]), 'INVALID_TRAIL');
  fails(() => index([]), 'INVALID_TRAIL');
});
test('URL parameters validate calendar dates, required values and ranges', () => {
  const good = '/offline?t=TA&p=F&dt=20261205T0800&s=175,-40&e=175.1,-40.1';
  assert.equal(parseOfflineUrl(good).appliesTo, 'Far Point Trail');
  for (const bad of [good.replace('20261205', '20260230'), good.replace('T0800', 'T2500')]) fails(() => parseOfflineUrl(bad), 'INVALID_TIME');
  fails(() => parseOfflineUrl(good + '&t=TA'), 'INVALID_URL');
  fails(() => parseOfflineUrl(good.replace('p=F', 'p=X')), 'INVALID_PATH');
  fails(() => parseOfflineUrl(good.replace('t=TA', 't=OTHER')), 'UNKNOWN_TRAIL');
  fails(() => parseOfflineUrl(good.replace('s=175,-40', 's=181,-40')), 'INVALID_POINT');
  fails(() => parseOfflineUrl(good.replace('s=175,-40', 's=,-40')), 'INVALID_POINT');
});
test('real trail has seven chains and conserves all section lengths', () => {
  assert.equal(real.chains.length, 7);
  assert.equal(real.chains.reduce((sum, chain) => sum + chain.sectionIds.length, 0), 466);
  const expected = feature.geometry.coordinates.reduce((sum, line) => sum + line.slice(1).reduce((n, p, i) => n + distanceMeters(line[i], p), 0), 0);
  near(real.chains.reduce((sum, chain) => sum + chain.distances.at(-1), 0), expected);
});
for (const example of previewExamples) {
  test(`realistic URL: ${example.name}`, () => {
    const request = parseOfflineUrl('/offline' + example.query);
    if ('error' in example) {
      fails(() => extractTrailSection(real, request.start, request.end), example.error); return;
    }
    const result = extractTrailSection(real, request.start, request.end);
    near(result.distanceMeters / 1000, example.kilometers, .002);
    assert.ok(result.distanceMeters >= 20000 && result.distanceMeters <= 35000);
    assert.ok(result.snappedStart.distanceMeters < 1 && result.snappedEnd.distanceMeters < 1);
    assert.ok(request.start[1] < request.end[1], 'northbound example');
    const reverse = extractTrailSection(real, request.end, request.start);
    assert.deepEqual(reverse.geometry.coordinates, [...result.geometry.coordinates].reverse());
    near(reverse.distanceMeters, result.distanceMeters);
  });
}
test('valid 5.84 km straight road retained and can be snapped midsegment', () => {
  const road = feature.geometry.coordinates[45];
  const a = road[3], b = road[4];
  const result = extractTrailSection(real, a, b);
  near(result.distanceMeters, 5842.3766, .01);
  const middle = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  assert.ok(snapToTrail(real, middle).distanceMeters < 2);
});
