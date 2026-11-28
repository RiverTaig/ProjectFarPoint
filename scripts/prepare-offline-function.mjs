// Bundles local helper modules into one file for the Supabase Dashboard editor.
// No database access, deployment, or credentials are involved.
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
await mkdir(new URL('supabase/deploy/', root), { recursive: true });
for (const name of ['submit-offline-activity','offline-activity-content','strava-activity-content','strava-import-activity','strava-import-route']) {
await build({
  entryPoints: [fileURLToPath(new URL(`supabase/functions/${name}/index.ts`, root))],
  outfile: fileURLToPath(new URL(`supabase/deploy/${name}.ts`, root)),
  bundle: true, format: 'esm', platform: 'neutral', target: 'es2022',
  external: ['npm:*'],
  banner: { js: `// GENERATED: paste this entire file into the ${name} Edge Function editor.\n// Do not paste into SQL Editor. Regenerate with node scripts/prepare-offline-function.mjs.\n// @ts-nocheck -- generated JavaScript in a .ts dashboard entrypoint; source is typechecked separately.` },
});
console.log(`Prepared supabase/deploy/${name}.ts. Nothing deployed.`);
}
