import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createOfflineHandler, resolveLocalDateTime } from '../supabase/functions/_shared/offlineSubmission.ts';
import { previewExamples } from '../src/offline/previewExamples.ts';

const ownerId = '11111111-1111-4111-8111-111111111111';
const password = 'test-only-password';
const feature = JSON.parse(readFileSync(new URL('../public/TeAraroaTrail_2026_27.geojson', import.meta.url), 'utf8'));
const params = Object.fromEntries(new URLSearchParams(previewExamples[0].query));
function setup(overrides = {}) {
  const calls = [];
  const store = {
    async trail(code) { calls.push(['trail', code]); return { id: 'trail', code, timezone: 'Pacific/Auckland', snap_tolerance_meters: 100 }; },
    async prepare(...args) { calls.push(['prepare', ...args]); return { state: 'claimed', request: { id: 'request', processing_token: 'token', trail_version_id: 'version', trail_timezone: 'Pacific/Auckland', started_at: '2026-12-04T19:00:00.000Z' } }; },
    async geometry(id) { calls.push(['geometry', id]); return feature; },
    async complete(request, section) { calls.push(['complete', request, section]); return { status: 'completed', requestId: 'request', activityId: 'activity', distanceMeters: section.distanceMeters }; },
    async fail(...args) { calls.push(['fail', ...args]); },
    ...overrides,
  };
  let storeOpened = 0;
  const handler = createOfflineHandler({ config: () => ({ password, ownerId }),
    store: () => { storeOpened++; return store; }, allowedOrigins: () => ['https://projectfarpoint.com'] });
  const submit = (body = { ...params, pw: password }, extra = {}) => handler(new Request('https://example.invalid/submit-offline-activity', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...extra,
  }));
  return { handler, submit, calls, opened: () => storeOpened };
}
test('GET with password in query never opens a database or creates an activity', async () => {
  const ctx = setup();
  const response = await ctx.handler(new Request(`https://example.invalid/?pw=${password}`));
  assert.equal(response.status, 405); assert.equal(ctx.opened(), 0);
});
test('OPTIONS and denied origins do not access the database', async () => {
  const ctx = setup();
  assert.equal((await ctx.handler(new Request('https://example.invalid/', { method: 'OPTIONS', headers: { origin: 'https://projectfarpoint.com' } }))).status, 204);
  assert.equal((await ctx.submit(undefined, { headers: { origin: 'https://other.invalid', 'content-type': 'application/json' } })).status, 403);
  assert.equal(ctx.opened(), 0);
});
test('missing/wrong passwords fail before database lookup and are never echoed', async () => {
  const ctx = setup();
  for (const pw of [undefined, 'incorrect', null, 123]) {
    const response = await ctx.submit({ ...params, pw });
    assert.equal(response.status, 401); assert.ok(!(await response.text()).includes(password));
  }
  assert.equal(ctx.opened(), 0);
});
test('missing configuration fails closed', async () => {
  const handler = createOfflineHandler({ config: () => null, store: () => { throw Error('must not open'); }, allowedOrigins: () => [] });
  assert.equal((await handler(new Request('https://example.invalid', { method: 'POST' }))).status, 503);
});
test('invalid and oversized JSON bodies fail without touching the database', async () => {
  const ctx = setup();
  for (const body of ['{', '[]', JSON.stringify({ ...params, pw: 'a'.repeat(5000) })]) {
    const response = await ctx.handler(new Request('https://example.invalid', { method: 'POST', headers: { 'content-type': 'application/json' }, body }));
    assert.equal(response.status, 422);
  }
  assert.equal(ctx.opened(), 0);
});
test('password-valid request uses fixed owner, stored geometry, and no secret in persisted input/result', async () => {
  const ctx = setup();
  const response = await ctx.submit({ ...params, pw: password, ownerId: 'attacker', geometry: {}, distanceMeters: 9999999 });
  assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.status, 'completed');
  assert.ok(body.distanceMeters > 24000 && body.distanceMeters < 25000);
  assert.equal(ctx.calls.find(([name]) => name === 'prepare')[1], ownerId);
  assert.equal(ctx.calls.find(([name]) => name === 'prepare')[4], '2026-12-04T19:00:00.000Z');
  assert.equal(JSON.stringify(ctx.calls).includes(password), false);
  assert.equal(JSON.stringify(body).includes(password), false);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('completed duplicate returns existing result without extracting again', async () => {
  const ctx = setup({ async prepare() { return { state: 'completed', result: { status: 'already_processed', activityId: 'existing' } }; } });
  const response = await ctx.submit(); assert.equal((await response.json()).activityId, 'existing');
  assert.deepEqual(ctx.calls.map(([name]) => name), ['trail']);
});
test('in-progress duplicate returns honest pending status and retry guidance', async () => {
  const ctx = setup({ async prepare() { return { state: 'processing', requestId: 'existing' }; } });
  const response = await ctx.submit(); assert.equal(response.status, 202);
  assert.equal(response.headers.get('retry-after'), '5'); assert.equal((await response.json()).status, 'processing');
});
test('off-trail and gap failures are recorded against the claim for retry', async () => {
  for (const example of previewExamples.filter((example) => 'error' in example)) {
    const ctx = setup(); const body = Object.fromEntries(new URLSearchParams(example.query));
    const response = await ctx.submit({ ...body, pw: password });
    assert.equal(response.status, 422); assert.equal((await response.json()).code, example.error);
    assert.equal(ctx.calls.find(([name]) => name === 'fail')[2], example.error);
    assert.equal(ctx.calls.some(([name]) => name === 'complete'), false);
  }
});
test('database errors do not disclose internal messages or overwrite completed requests', async () => {
  const ctx = setup({ async complete() { throw Error('database password should never appear'); }, async fail() { throw Error('connection lost'); } });
  const response = await ctx.submit(); assert.equal(response.status, 500);
  assert.ok(!(await response.text()).includes('database password'));
});
test('New Zealand local timestamps handle summer, winter, leap days, DST gaps and repeated hours', () => {
  assert.equal(resolveLocalDateTime('20261205T0800', 'Pacific/Auckland'), '2026-12-04T19:00:00.000Z');
  assert.equal(resolveLocalDateTime('20260605T0800', 'Pacific/Auckland'), '2026-06-04T20:00:00.000Z');
  assert.equal(resolveLocalDateTime('20280229T0800', 'Pacific/Auckland'), '2028-02-28T19:00:00.000Z');
  assert.throws(() => resolveLocalDateTime('20260927T0230', 'Pacific/Auckland'), /does not exist/);
  assert.throws(() => resolveLocalDateTime('20260405T0230', 'Pacific/Auckland'), /repeated/);
});
