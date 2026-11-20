# Far Point Trail segments

FPT segments reuse the existing `trails`, immutable `trail_versions`, offline
submission, distance credit, description, and image storage implementation.
The existing storage bucket, offline password, and content function are reused.
The browser import action needs the one-time owner import migration below.
The map loads published segments from Supabase on page load. It discovers segment
codes rather than keeping a fixed list in the frontend, and loads four at a time.
Reference lines match the muted yellow Te Araroa line; completed hikes retain the
existing Far Point Trail activity styling and progress calculation.

## Import from the app (recommended)

Apply `supabase/migrations/20261119120000_owner_trail_import.sql` once in the
Supabase SQL Editor, then deploy the updated website. No new Edge Function or
database connection URI is needed for browser imports.

Sign in as `RiverMadsen23@gmail.com`, choose **Import Trail GPX**, select the file,
review the segment/point count and timezone, and press **Import Trail GPX**.
On mobile, the link is inside the account icon menu to keep the header compact.
You can also open `/?adminPage=importTrail` while signed in.

The database checks the authenticated user's confirmed email itself; hiding the
button is not the authorization mechanism. Anonymous and other accounts cannot
import. Track gaps and all GPX points are preserved (consecutive duplicates are
removed as in the Python importer). The import is atomic and repeated submissions
of the same file/version return the existing segment. A version with different
content is rejected; select a new version for corrections. New browser revisions
become the current map version; replaying an older version does not roll it back.
Imports from Python and the browser can be replayed interchangeably.

After success, choose **View map** to return to the home page and load the new
segment. Importing reference geometry creates no activities or distance credit.
The existing `/offline` workflow continues to handle actual hikes, text and photos.

## Automatic command-line import

Install the optional PostgreSQL driver once:

```powershell
python -m pip install -r scripts/requirements-fpt.txt
```

Then generate and upload a segment in one command:

```powershell
python scripts/prepare-fpt-import.py FPT_2.gpx --upload
```

On the first run, paste your PostgreSQL connection URI at the hidden prompt.
Get it from **Supabase Dashboard > Connect**; the **Session pooler** URI is useful
on IPv4 networks. Replace the password placeholder with your actual database
password (URL-encode special characters). This is different from the public
website URL, anon key, or shared offline submission password. Keep the URI local.

To avoid the prompt on subsequent runs, copy `.env.fpt-import.example` to
`.env.fpt-import` in the project root and fill in `SUPABASE_DB_URL` there. That
local file is ignored by Git and is read only by the Python importer. An existing
`SUPABASE_DB_URL` environment variable takes precedence over the file.
The importer requires an encrypted connection and never prints the connection URI.

The command runs setup, exactly the generated numbered data parts, then finalize.
It stops on the first error, and the same command can be replayed safely. For FPT2
the files are `00-setup.sql`, `01-data.sql`, `02-data.sql`, and `99-finalize.sql`.
Multiple source files can be imported in one invocation. Refresh the app afterward;
adding segments does not require a website redeployment.

Without `--upload`, the script still only generates local files and requires no
database credentials or PostgreSQL driver.

Driver installation follows the [Psycopg documentation](https://www.psycopg.org/psycopg3/docs/basic/install.html).

## Manual SQL Editor alternative: import FPT_1.gpx

The generated SQL is ready in `supabase/imports/fpt1-1/`. In the existing project's
Supabase SQL Editor, run the **entire contents** of each file in this order:

1. `00-setup.sql`
2. `01-data.sql`
3. `02-data.sql`
4. `99-finalize.sql`

This requires the existing offline activity migrations already used for Te Araroa.
Do not rerun those migrations. The finalize result should show `FPT1`, version `1`,
timezone `America/Edmonton`, and the name `Far Point Trail — FPT_1 > Coleman`.
The import preserves 5,149 points from the supplied GPX and its source attribution.
Staged chunks are private, checksummed, and safe to replay. An existing version
with different contents is rejected. Importing geometry creates no activities or
distance credit. Generated `geometry.geojson` is a test fixture, not a frontend asset.

## Website and Edge Function

Build/deploy the updated website through the project's usual process.
Redeploy **submit-offline-activity** using the updated
`supabase/deploy/submit-offline-activity.ts` in the Dashboard editor, or the normal
CLI source deployment. Keep the existing secrets and disabled JWT verification.
The updated function rejects `p=V` for FPT segment codes, so FPT hikes always credit
Far Point Trail. `offline-activity-content` already supports these hikes and does
not need redeployment for this change. See `OFFLINE_STEP5.md` for deployment details.

No remote database changes or website/Edge deployments were performed while
preparing this implementation.

## Report a hike

Use the same `/offline` page, shared submission password, text editor, image uploads,
and image/gallery references as Te Araroa. The link parameters are:

```text
/offline?t=FPT1&p=F&dt=YYYYMMDDTHHMM&s=START_LONGITUDE,START_LATITUDE&e=END_LONGITUDE,END_LATITUDE
```

`dt` is local trail time (Alberta for FPT1), and coordinates are **longitude,latitude**.
Endpoints must be within 100 meters of the registered trail. Preview reconstructs
the path between them; Submit creates the hike. Repeated submissions return the
same hike, and retracing already credited Far Point geometry earns no extra credit.
Text and photos use the existing upload/retry flow without changing distance credit.

`supabase/imports/fpt1-1/offline-example.txt` contains a full-segment **preview-only**
link. Its date is illustrative: it cannot create an activity while `preview=1` is
present. For a real hike use its actual date, endpoints, and omit `preview=1`.

## Add subsequent segments

From the project root, with Python 3 installed:

```powershell
python scripts/prepare-fpt-import.py FPT_2.gpx FPT_3.gpx
```

Each input produces its own SQL directory under `supabase/imports/`. Run setup,
all numbered data parts, then finalize for that segment. `FPT_2.gpx` registers
`FPT2`, `FPT_101.gpx` registers `FPT101`, etc. Once imported, refresh the website;
no code changes or website redeployment are needed to discover later segments.

Use `--timezone America/Vancouver` (or the appropriate IANA timezone) for segments
outside Alberta. The default is `America/Edmonton`; do not use it blindly for
segments in other timezones. A hike crossing separately registered segments must
currently be submitted as one section per segment; endpoints cannot span codes.
GPX track/route sections are preserved, and gaps are never bridged artificially.

For corrected geometry, generate a new immutable version:

```powershell
python scripts/prepare-fpt-import.py FPT_1.gpx --version 2
```

Run its generated SQL. To publish the revision after reviewing it, run:

```sql
update public.trails t set current_version_id = v.id
from public.trail_versions v
where t.code = 'FPT1' and v.trail_id = t.id and v.version = '2';
```

Initial imports only set an empty current pointer, so replaying an old import
cannot roll a later version back. Existing offline hikes keep their pinned geometry.

## Local validation

```powershell
npm run test:offline
python scripts/test-fpt-import.py
npx tsc -b
node --experimental-strip-types scripts/test-offline-database.mjs
```

The database suite uses the existing isolated PostgreSQL/PostGIS test dependencies
described in `OFFLINE_STEP5.md`. It imports/replays FPT1 SQL, reads its geometry as
an anonymous user, submits a Far Point Trail hike, saves text and image metadata,
and checks retry deduplication and repeated-distance exclusion. It never accesses
the remote Supabase database.
