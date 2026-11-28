import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
// Exercise the actual opening-tour function without requiring a WebGL browser.
const source = ts.createSourceFile('main.tsx', readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const opening = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'playOpeningGlobeAnimation');
function load(reducedMotion = false) {
  const context = vm.createContext({ Camera: class { constructor(properties) { Object.assign(this, properties); } }, window: { matchMedia: () => ({ matches: reducedMotion }) } });
  vm.runInContext(ts.transpile(opening.getText(source), { target: ts.ScriptTarget.ES2022 }), context);
  return context.playOpeningGlobeAnimation;
}
test('a cancelled delayed opening never moves the map', async () => {
  let moves = 0;
  await load()({ goTo: async () => { moves++; } }, () => true);
  assert.equal(moves, 0);
});
test('cancelling an in-flight stage prevents the remaining Spain tour stages', async () => {
  let finishStage;
  const calls = [];
  let cancelled = false;
  const pending = load()({ goTo: (camera) => { calls.push(camera); return new Promise((resolve) => { finishStage = resolve; }); } }, () => cancelled);
  assert.equal(calls.length, 1);
  cancelled = true;
  finishStage();
  await pending;
  assert.equal(calls.length, 1);
});
test('the normal opening still completes all three stages', async () => {
  const calls = [];
  await load()({ goTo: async (camera) => { calls.push(camera); } }, () => false);
  assert.equal(calls.length, 3);
  assert.equal(calls.at(-1).position.longitude, -3.7);
});
test('reduced motion uses a single non-animated move', async () => {
  const calls = [];
  await load(true)({ goTo: async (_camera, options) => { calls.push(options); } }, () => false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].animate, false);
});
