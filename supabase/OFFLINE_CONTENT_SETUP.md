# Offline descriptions and photos

Ken can paste the satellite message, select photos from his phone, give them
short names/captions, and insert image references. Saving uses the existing
shared password; no new account or secret is needed.

## Enable the server changes

1. In Supabase **SQL Editor**, run the entire file
   `supabase/migrations/20261116120000_offline_activity_content.sql` once.
   This requires the existing `project_activity_images` table and image bucket
   from the earlier image migrations. It creates one server-only RPC and does
   not change any existing hikes or public write policies.
2. In **Edge Functions**, deploy a new function named
   **`offline-activity-content`**, using the editor. Paste the entire generated
   `supabase/deploy/offline-activity-content.ts` into its `index.ts`.
   This is TypeScript/JavaScript; do not paste it into SQL Editor.
3. Disable **Verify JWT** for this new function. It verifies
   `OFFLINE_SUBMISSION_PASSWORD` and uses `OFFLINE_ACTIVITY_OWNER_ID`, just like
   the existing submission function. The existing `APP_ORIGINS` allowlist also
   applies. Keep all existing origins, including the local port being used.
4. The existing `submit-offline-activity` function needs no redeployment for
   this feature. Deploy the website code separately for the live domain.

CLI alternative (with Supabase CLI login already configured):

```powershell
npx supabase functions deploy offline-activity-content --project-ref YOUR_PROJECT_REF --no-verify-jwt
```

Regenerate the Dashboard bundles after changing server source with:

```powershell
node scripts/prepare-offline-function.mjs
```

## Ken's workflow

1. Open the normal offline link. Review the trail preview.
2. Paste the message into **Description of the day's walk**.
3. Choose photos under **Add photos from your phone**. Each gets an automatic
   unique name that can be changed to something memorable, such as `camp`.
4. Add optional captions. Use **Insert image reference** to place a photo in
   the description, or **Insert gallery reference** for a swipeable gallery.
5. Enter the password if it was not in the link, then submit. The hike saves
   first; photos upload one at a time, then the final description is saved.
   Keep the page open until **Text and images saved** appears.

Examples understood by the existing activity renderer:

```text
We reached camp just before sunset.

{Image name="camp" caption="Evening at camp"}

Views from today's walk:

{ImageCarousel images="ridge,camp"}
```

Names are case-insensitive in references. Allowed names have 1–64 letters,
numbers, underscores or hyphens and start with a letter or number. If a caption
is not specified in the reference, the saved photo caption is used.
New photos without a reference are automatically added as a gallery after the
description. Photo names must be unique within a hike.

Limits match existing storage: 10 photos per hike, 10 MB each, JPEG/PNG/WebP/GIF.
HEIC must be converted before selection. The description limit is 20,000
characters, including image references. Captions are at most 1,000 characters.

## Retries and existing hikes

- If the hike was already submitted, the same link returns its existing ID.
  Adding text/images does not create another hike or change its distance.
- If an upload fails, the page distinguishes **hike saved** from **content
  incomplete**. **Save text and images** retries unfinished content. Keep the
  same files and names during a retry; completed uploads are skipped in the tab.
- Image storage paths include the file hash, making retries safe even if a
  response was lost. Reusing a name for a different file is rejected rather
  than overwriting the old photo. Use a new name for a different image.
- Existing content is read automatically when saving text/photos. There is no
  manual load button; Ken is done when **Text and images saved** appears.
- An untouched blank description never clears an existing story. Editing the
  description to blank is an intentional text change; selected photos still
  receive references as described above.
- Draft text/files stay in tab memory, not persistent browser storage. Refresh
  loses unsaved drafts/files; reopen the link and reselect them if necessary.
  Photos are public through the same bucket used by the existing activity page.
- Storage upload and metadata insert cannot share one transaction. A failed
  metadata insert can leave an unreferenced content-addressed object; retry is
  safe. No cleanup deletes potentially referenced objects automatically.

## Verification

```powershell
npm run test:offline
node --experimental-strip-types scripts/test-offline-database.mjs
npx --yes deno check supabase/functions/offline-activity-content/index.ts
```

Database tests use the isolated PGlite/PostGIS dependencies described in
`OFFLINE_STEP5.md`; they do not access remote Supabase. Browser verification
intercepts all submission/upload calls and tests a failed upload followed by a
successful retry without duplicate hike creation. No live text/photos have
been written while implementing this feature.
