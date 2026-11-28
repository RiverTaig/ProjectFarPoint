# Strava activity text and photos

Selecting a completed Strava activity loads its description and up to ten photos into the import form. Text, image names, captions, files, and removals can be edited before import. Photos are copied to the existing project image storage only when Import is clicked. Routes keep their existing behavior.

## Deploy the new Edge Function

Create an Edge Function named `strava-activity-content` in the Supabase Dashboard. Paste the entire contents of `supabase/deploy/strava-activity-content.ts` into its editor and deploy. Keep JWT verification enabled, matching the existing Strava functions. It uses the existing Strava credentials, Supabase configuration, and `APP_ORIGINS` secret; no migration or new secret is needed.

CLI alternative with Supabase CLI authentication configured:

```powershell
npx supabase functions deploy strava-activity-content --project-ref wfxldzfcniatpqqycskx
```

Regenerate the Dashboard bundle after editing function source with `node scripts/prepare-offline-function.mjs`.

## Verify

Load Strava activities and select one with a description and photos. Wait for loading to finish. Confirm the description, photo previews, editable names/captions, and selected filenames appear. Edit the text, remove a photo, and import. Check the saved text and remaining photos. Switch rapidly between activities to confirm earlier requests cannot populate the new selection. Select an activity without photos to confirm previous photos clear.

Use Reload Strava text and photos to retry a failed request; reloading replaces the current form text and images. Photo failures appear in the form and do not prevent manually adding content or importing geometry. Strava photo access depends on what its API makes available for the connected account.

Local checks:

```powershell
node --test scripts/test-strava-content.mjs
npx --yes deno check supabase/functions/strava-activity-content/index.ts
npm run build
```
