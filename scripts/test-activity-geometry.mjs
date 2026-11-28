import assert from 'node:assert/strict';
import { test } from 'node:test';
import { geometryTolerances, simplifyCoordinates } from '../supabase/functions/_shared/simplifyCoordinates.ts';
const rectangle = [[-122.65,45.56,10],[-122.64,45.56,11],[-122.64,45.563,12],[-122.65,45.563,13],[-122.65,45.56,10]];
test('retains every corner of a short closed city-block loop', () => {
  assert.deepEqual(simplifyCoordinates(rectangle, geometryTolerances.medium), rectangle);
  assert.ok(simplifyCoordinates(rectangle, 0.005).length < rectangle.length);
});
test('removes straight-line samples while preserving endpoints and altitude', () => {
  const track = [[0,0,5],[0.001,0,6],[0.002,0,7]];
  assert.deepEqual(simplifyCoordinates(track, geometryTolerances.medium), [track[0],track[2]]);
});
test('retains backtracking beyond a segment endpoint', () => {
  const track = [[0,0],[0.01,0],[0.002,0]];
  assert.deepEqual(simplifyCoordinates(track, geometryTolerances.medium), track);
});
test('handles long GPS streams without recursive call stack growth', () => {
  const track = Array.from({length:100000}, (_, i) => [i / 1000000, 45, i]);
  assert.deepEqual(simplifyCoordinates(track, geometryTolerances.medium), [track[0],track.at(-1)]);
});
test('handles empty and one-point tracks', () => {
  assert.deepEqual(simplifyCoordinates([], geometryTolerances.medium), []);
  assert.deepEqual(simplifyCoordinates([[1,2]], geometryTolerances.medium), [[1,2]]);
});
