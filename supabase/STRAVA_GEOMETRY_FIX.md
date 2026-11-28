# Strava display geometry and uncropped photos

The carousel now fits the complete photo in its frame. Refresh the running local app to see this change. Publish the frontend normally to update the hosted website.

The Going/Alberta Loop has 1,798 full GPS points stored, but the old 0.005-degree display tolerance reduced it to 3 points. The corrected 0.00002-degree tolerance retains 56 points. Strava activity and route imports now share the simplifier, use conservative tolerances (about 2.2 metres maximum for the medium level), and measure distance to the finite segment so backtracking is retained. The implementation is iterative to support long GPS streams.

## Repair saved activities

In Supabase SQL Editor, run all of `supabase/migrations/20261128120000_repair_strava_display_geometry.sql`. It rebuilds the three display geometries from existing full tracks for Strava activities and routes. It preserves full tracks, IDs, descriptions, photo references, stored images, and distance credit. Offline activities are unchanged. It is safe to rerun. The final query reports full and display point counts.

Refresh the app after running the SQL. No reimport is needed.

## Fix future imports

Update the existing `strava-import-activity` Edge Function using the complete contents of `supabase/deploy/strava-import-activity.ts`. Also update `strava-import-route` using `supabase/deploy/strava-import-route.ts`. Keep existing JWT verification and secrets. These are Edge Function files, not SQL.

Regenerate these Dashboard bundles with `node scripts/prepare-offline-function.mjs` after modifying source.

## Verification

- `node --experimental-strip-types --test scripts/test-activity-geometry.mjs`
- `npx --yes deno check supabase/functions/strava-import-activity/index.ts supabase/functions/strava-import-route/index.ts`
- `npm run build`
- Isolated migration check: install `@electric-sql/pglite` and `@electric-sql/pglite-postgis` into a temporary `pfp-geometry-db-test` directory under the OS temp directory, then run `node --experimental-strip-types scripts/test-activity-geometry-database.mjs`. Set `PFP_SQL_TEST_MODULE_ROOT` if using another install directory.

The repair was tested locally in PostGIS; it was not applied to remote Supabase. The updated Edge Functions were prepared, not deployed. Inspect the photo and map after applying the SQL and refreshing.
