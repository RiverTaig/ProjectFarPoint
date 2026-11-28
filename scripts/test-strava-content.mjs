import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const source = readFileSync(new URL('../supabase/functions/strava-activity-content/index.ts', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '');
function setup({ photos = [], photoStatus = 200, authorized = true } = {}) {
  let handler;
  const calls = [];
  const context = vm.createContext({ Response, Request, URL, Number, Object, Array, Error,
    corsHeaders: () => ({ 'Access-Control-Allow-Origin': '*' }),
    getAuthorizedUser: async () => { if (!authorized) throw new Error('You must be signed in.'); return { id: 'owner' }; },
    getFreshStravaConnection: async () => ({ connection: { access_token: 'secret' } }),
    Deno: { serve: (fn) => { handler = fn; } },
    fetch: async (url, options) => { calls.push({ url, options });
      if (url.includes('/photos?')) return Response.json(photos, { status: photoStatus });
      if (url.startsWith('https://images.example/')) return new Response(new Uint8Array([1, 2]), { headers: { 'Content-Type': 'image/jpeg' } });
      return Response.json({ description: 'A day on the trail.' });
    },
  });
  vm.runInContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }), context);
  return { calls, request: (body) => handler(new Request('https://example.test', { method: 'POST', body: JSON.stringify(body) })) };
}
test('loads description and editable names/captions, with ten-photo limit', async () => {
  const app = setup({ photos: Array.from({ length: 12 }, () => ({ caption: 'Camp' })) });
  const result = await (await app.request({ activityId: 123 })).json();
  assert.equal(result.description, 'A day on the trail.'); assert.equal(result.photos.length, 10);
  assert.deepEqual(result.photos[0], { index: 0, name: 'strava_1', caption: 'Camp' }); assert.match(result.warning, /10/);
});
test('keeps description when photos are unavailable', async () => {
  const app = setup({ photoStatus: 403 }); const result = await (await app.request({ activityId: 123 })).json();
  assert.equal(result.description, 'A day on the trail.'); assert.match(result.warning, /could not be loaded/);
});
test('proxies photo bytes without forwarding Strava credentials', async () => {
  const app = setup({ photos: [{ urls: { 1600: 'https://images.example/photo.jpg' } }] });
  const response = await app.request({ activityId: 123, photoIndex: 0 });
  assert.equal(response.headers.get('content-type'), 'application/octet-stream');
  assert.equal(response.headers.get('x-image-type'), 'image/jpeg');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2]);
  assert.equal(app.calls.at(-1).options, undefined);
});
test('rejects unauthorized callers and invalid IDs before Strava requests', async () => {
  for (const [options, body] of [[{ authorized: false }, { activityId: 123 }], [{}, { activityId: '../bad' }]]) {
    const app = setup(options); assert.equal((await app.request(body)).status, 500); assert.equal(app.calls.length, 0);
  }
});
