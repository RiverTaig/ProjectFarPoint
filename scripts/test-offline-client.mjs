import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readOfflineLink, offlineSubmissionBody, submitOfflineActivity } from '../src/offline/offlineClient.ts';

const link = 'https://projectfarpoint.com/offline?t=TA&p=V&dt=20261205T0800&s=175.631794,-40.310686&e=175.445552,-40.185459';
const configuration = { url: 'https://example.supabase.co', anonKey: 'public-test-key' };
const password = 'test-only-password';
test('incoming password removed from visible URL, including duplicate and encoded keys', () => {
  const read = readOfflineLink(`${link}&pw=${password}`);
  assert.equal(read.password, password); assert.equal(new URL(read.url).searchParams.has('pw'), false);
  const duplicates = readOfflineLink(`${link}&pw=one&p%77=two`);
  assert.equal(duplicates.password, ''); assert.ok(duplicates.passwordError);
  assert.equal(new URL(duplicates.url).searchParams.has('pw'), false);
});
test('POST body is whitelisted and example links are blocked', () => {
  const body = offlineSubmissionBody(link + '&owner=attacker&distance=9999', password);
  assert.deepEqual(Object.keys(body), ['t', 'p', 'dt', 's', 'e', 'pw']);
  assert.equal(body.pw, password);
  assert.throws(() => offlineSubmissionBody(link + '&preview=1', password), /preview only/);
  assert.throws(() => offlineSubmissionBody(link, ''), /password/);
});
test('explicit submission uses POST body, public key, no credentials or referrer', async () => {
  let calls = 0;
  const result = await submitOfflineActivity(link, password, configuration, async (url, init) => {
    calls++; assert.equal(url, 'https://example.supabase.co/functions/v1/submit-offline-activity');
    assert.equal(url.includes(password), false); assert.equal(init.method, 'POST');
    assert.equal(init.credentials, 'omit'); assert.equal(init.referrerPolicy, 'no-referrer');
    assert.equal(init.headers.apikey, 'public-test-key'); assert.equal(JSON.parse(init.body).pw, password);
    return Response.json({ status: 'completed', activityId: 'activity', creditedKilometers: 24.7 });
  });
  assert.equal(calls, 1); assert.equal(result.status, 'completed');
});
test('failed and pending server statuses remain failed and pending', async () => {
  const failed = await submitOfflineActivity(link, password, configuration,
    async () => Response.json({ status: 'failed', code: 'UNAUTHORIZED', error: 'Wrong password.' }, { status: 401 }));
  assert.equal(failed.code, 'UNAUTHORIZED');
  const pending = await submitOfflineActivity(link, password, configuration,
    async () => Response.json({ status: 'processing', requestId: 'request', retryAfterSeconds: 5 }, { status: 202 }));
  assert.equal(pending.status, 'processing');
});
test('undocumented secret fields and echoed passwords are removed from result', async () => {
  const result = await submitOfflineActivity(link, password, configuration,
    async () => Response.json({ status: 'failed', error: `Invalid ${password}`, pw: password, password, debug: { body: password } }, { status: 422 }));
  assert.equal(JSON.stringify(result).includes(password), false);
  assert.equal('debug' in result, false); assert.equal('pw' in result, false);
});
test('configuration, transport, malformed response, and false completion fail safely', async () => {
  await assert.rejects(submitOfflineActivity(link, password, {}), /not configured/);
  await assert.rejects(submitOfflineActivity(link, password, { url: 'http://insecure.example' }), /secure/);
  await assert.rejects(submitOfflineActivity(link, password, configuration, async () => { throw new Error('network'); }), /Retry the same hike/);
  await assert.rejects(submitOfflineActivity(link, password, configuration, async () => new Response('not-json')), /unreadable/);
  await assert.rejects(submitOfflineActivity(link, password, configuration, async () => Response.json({ status: 'completed' })), /unexpected/);
});
