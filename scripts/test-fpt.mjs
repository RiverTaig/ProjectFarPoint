import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTrailIndex, extractTrailSection, parseOfflineUrl } from '../src/offline/trailExtraction.ts';
import { offlineSubmissionBody } from '../src/offline/offlineClient.ts';
import { resolveLocalDateTime, createOfflineHandler } from '../supabase/functions/_shared/offlineSubmission.ts';

const feature = JSON.parse(readFileSync(new URL('../supabase/imports/fpt1-1/geometry.geojson', import.meta.url), 'utf8'));
const points = feature.geometry.coordinates[0];
const start = points[0], end = points.at(-1);
const registration = { code: 'FPT1', timezone: 'America/Edmonton' };
const link = `https://projectfarpoint.com/offline?t=FPT1&p=F&dt=20260715T0800&s=${start}&e=${end}`;

test('actual FPT1 GPX extracts in both directions without changing vertices', () => {
  assert.equal(points.length, 5149);
  assert.ok(Math.abs(start[1] - 49) < .01);
  const index = buildTrailIndex(feature);
  const section = extractTrailSection(index, start, end);
  assert.deepEqual(section.geometry.coordinates, points);
  assert.ok(section.distanceMeters > 50000 && section.distanceMeters < 200000);
  assert.deepEqual(extractTrailSection(index, end, start).geometry.coordinates, [...points].reverse());
});

test('FPT1 links submit as Far Point Trail in Alberta local time; Voyager rejected', () => {
  const request = parseOfflineUrl(link, registration);
  assert.equal(request.appliesTo, 'Far Point Trail');
  assert.equal(resolveLocalDateTime(request.localDateTime, request.timezone), '2026-07-15T14:00:00.000Z');
  assert.equal(offlineSubmissionBody(link, 'test-password').p, 'F');
  assert.throws(() => offlineSubmissionBody(link.replace('p=F', 'p=V'), 'test-password'), /require p=F/);
});

test('server resolves FPT1 geometry and forwards Far Point Trail credit; rejects Voyager before DB access', async () => {
  let calls = 0;
  const handler = createOfflineHandler({
    config: () => ({ password: 'test-password', ownerId: '11111111-1111-4111-8111-111111111111' }), allowedOrigins: () => [],
    store: () => ({
      async trail(code) { calls++; assert.equal(code, 'FPT1'); return { ...registration, id: 'trail', snap_tolerance_meters: 100 }; },
      async prepare(owner, trail, input, started) {
        assert.equal(input.appliesTo, 'Far Point Trail');
        assert.equal(started, '2026-07-15T14:00:00.000Z');
        return { state: 'claimed', request: { id: 'request', trail_version_id: 'version', processing_token: 'token' } };
      },
      async geometry(id) { assert.equal(id, 'version'); return feature; },
      async complete(request, section) { assert.deepEqual(section.geometry.coordinates, points); return { status: 'completed', activityId: 'activity' }; },
      async fail() { assert.fail('Unexpected failure'); },
    }),
  });
  const send = (p) => handler(new Request('https://example.invalid', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...offlineSubmissionBody(link, 'test-password'), p }) }));
  assert.equal((await (await send('F')).json()).status, 'completed');
  const response = await send('V');
  assert.equal((await response.json()).code, 'INVALID_PATH');
  assert.equal(calls, 1);
});
