# Offline activity processing: step 5

The server-side implementation is ready for deployment. No remote SQL or Edge
Function deployment was performed while preparing these files. River has since
confirmed the SQL, secrets, deployment, and authentication validation succeeded.
Step 6 now implements the `/offline` Submit action locally; website deployment
and an intended successful live hike submission still need to be verified.

## 1. Apply the SQL

In your Project Far Point Supabase project's SQL Editor, run the **entire** file:

`supabase/migrations/20261115130000_offline_activity_processing.sql`

Run it once, after the foundation migration and successful Te Araroa import.
Expect **Success. No rows returned**. This creates processing functions and
adds request authentication/lease fields; it creates no activities. Do not
repeat the earlier foundation migration or geometry import.

The SQL updates `submitted_by` to allow NULL for shared-password submissions,
because these have no signed-in user. It records `authentication_method` as
`shared_password`. The activity owner is still a real existing Auth user.
The earlier `offline_activity_submitters` table is unused by this workflow.

## 2. Find the activity owner ID

Run this read-only SQL to identify the owner of your existing imported hikes:

```sql
select owner_user_id, count(*) as activities
from public.project_activities
group by owner_user_id;
```

Use River's existing activity owner UUID below. If several owners appear,
inspect their activities to choose River's ID. Do not create a fake ID or give
Ken a database account. The fixed server-side owner keeps future Strava
matching associated with the same person.

## 3. Configure Edge Function secrets

Under **Edge Functions > Secrets**, add:

| Secret | Value |
| --- | --- |
| `OFFLINE_SUBMISSION_PASSWORD` | The agreed shared password (entered here, not in source code) |
| `OFFLINE_ACTIVITY_OWNER_ID` | River's existing activity owner UUID from step 2 |

The function also uses Supabase-provided `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`; do not put these in the satellite link or frontend.
Missing password/owner configuration returns HTTP 503 without creating records.

Review the existing `APP_ORIGINS` secret. Preserve any origins already needed
by Strava. Include your website and, for local tests, the development origin:

```text
https://projectfarpoint.com,http://localhost:5173,http://127.0.0.1:5173
```

If `APP_ORIGINS` is absent, this function allows browser requests from
`https://projectfarpoint.com` only. Requests without an Origin header, such as
the Dashboard tester or a command-line POST, still require the password.

## 4. Deploy the Edge Function

For the Dashboard editor, use the **generated single file**:

`supabase/deploy/submit-offline-activity.ts`

In **Edge Functions**, create a function via the editor named exactly
`submit-offline-activity`. Replace its `index.ts` contents with the entire
generated file and deploy. This is TypeScript/JavaScript, **not SQL**.

Disable **Verify JWT** / **Verify JWT with legacy secret** for this function.
Its handler validates the shared password instead of requiring a signed-in
user token. This is also recorded in `supabase/config.toml` for CLI deployment.
See Supabase's [Dashboard quickstart](https://supabase.com/docs/guides/functions/quickstart-dashboard)
and [function authentication documentation](https://supabase.com/docs/guides/functions/auth).

Alternatively, from the repository with Supabase CLI authentication configured:

```powershell
npx supabase functions deploy submit-offline-activity --project-ref YOUR_PROJECT_REF --no-verify-jwt
```

The CLI deploys the source entrypoint and `_shared` modules. To regenerate the
Dashboard bundle after changing source:

```powershell
node scripts/prepare-offline-function.mjs
```

## 5. Review before the first live test

Step 6 adds Ken's Submit action to the preview screen. Independently, the Edge
Function's Dashboard tester can send a POST with `Content-Type: application/json`
and the following body. Replace the password placeholder first:

```json
{
  "t": "TA",
  "p": "V",
  "dt": "20261205T0800",
  "s": "175.631794,-40.310686",
  "e": "175.445552,-40.185459",
  "pw": "YOUR_SHARED_PASSWORD"
}
```

**A successful POST creates a real activity visible to existing public activity
queries.** The date/coordinates above are illustrative, not a report of a hike
River actually completed. Review together before using a successful test on
production; preferably use a development Supabase project for write tests.
GET and OPTIONS never create activities. A wrong password returns 401 before
any database lookup or write. Do not include the password in the function URL;
the step 6 page will transfer it from the satellite URL into the POST body.

Expected outcomes:

- `completed` (200): request, activity, geometry, and credit committed atomically.
- `already_processed` (200): existing activity returned, no duplicate insert.
- `processing` (202): another request holds the processing lease. Retry the same
  POST after the supplied delay; there is no background worker.
- `failed` (422/500): readable validation/processing error; authenticated,
  claimed requests retain failure details and can be retried.

If a function crashes without recording a failure, retry after the five-minute
lease expires. Old processing tokens cannot overwrite a renewed/completed
request. Completed requests retain their original immutable trail version.

## Processing and progress behavior

- Only server-extracted geometry is accepted; caller owner IDs, geometry, and
  claimed distances are ignored. Trail data is loaded from Supabase.
- The password is verified server-side with a digest comparison. It is never
  included in request metadata, activities, readable responses, or code logs.
- Hike start time is resolved using the trail timezone. Nonexistent/repeated
  daylight-saving hours are rejected instead of guessed.
- The stored hiking distance is PostGIS spheroidal geography length. It can
  differ slightly from the preview's spherical calculation.
- Voyager credit calls the existing seasonal distance-made-good function.
  A backdated insertion recalculates affected later Voyager credits in the
  same season using that existing function and its current scope unchanged.
- Far Point Trail credits unrepeated geometry using a 15-meter overlap buffer
  against the owner's earlier Far Point hikes, without a seasonal reset. This
  implements the site's stated no-repeat rule; current Strava import code has
  no separate Far Point credit calculation. A backdated offline Far Point hike
  recalculates the owner's affected later Far Point credits.
- Offline completion/progress changes are serialized in one transaction.
  Existing Strava import endpoints do not yet take that same lock; avoid
  concurrent Strava imports during initial offline submission validation.
  Unified import/replacement coordination remains part of steps 7-8.
- Reserved superseded fields are not populated here; Strava replacement is
  still step 8. Don't import a duplicate hike expecting replacement yet.

## Local validation

```powershell
npm run test:offline
npx --yes deno check supabase/functions/submit-offline-activity/index.ts
```

For isolated actual PostgreSQL/PostGIS tests without remote database access,
install test dependencies outside the app and run the test script:

```powershell
npm install --prefix "$env:TEMP\pfp-offline-db-test" --no-audit --no-fund @electric-sql/pglite @electric-sql/pglite-postgis
node --experimental-strip-types scripts/test-offline-database.mjs
```

The database test uses PGlite's experimental PostGIS extension in memory. It
executes the actual migrations and import, then tests duplicate claims,
completion rollback, retry tokens, backdated credit, Far Point overlap, trail
version pinning, and client permission restrictions. It cannot reproduce the
hosted multi-connection runtime; final deployment testing remains necessary.
