# Offline activity foundation (step 3)

These files prepare storage only. They do not enable the `/offline` page,
trail extraction, request processing, or Strava replacement. No SQL has been
executed against your Supabase project by this task.

## Run in Supabase SQL Editor

1. Confirm you have selected the intended Project Far Point project. Existing
   project migrations must already be applied (`project_activities` must exist).
2. Open `supabase/migrations/20261115120000_offline_activity_foundation.sql`,
   copy the entire file into a new SQL Editor query, and run it **once**. It is
   transactional: an error rolls back its changes. Save the query for reference.
3. The full import exceeds the SQL Editor's limit in this project. Instead,
   run each file in `supabase/imports/te-araroa-parts/` as a separate query,
   in this order: `00-setup.sql`, `01-data.sql`, `02-data.sql`, `03-data.sql`,
   `04-data.sql`, `05-data.sql`, `06-data.sql`, then `99-finalize.sql`.
   Copy the entire contents of each file. Setup/data files should report
   success with no rows. Finalize verifies a SHA-256 checksum, imports the
   assembled geometry, and deletes its staging rows in one transaction.
   Expected final result: `TA`, `Te Araroa`,
   `Pacific/Auckland`, `2026-27`, and `466` sections. This import is replay-safe;
   it refuses to replace an existing version with different content.
4. Run the read-only verification query below. Expect four tables with RLS on
   and zero offline requests. Existing activities are not modified.

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('trails', 'trail_versions',
                    'offline_activity_requests', 'offline_activity_submitters');

select count(*) as offline_request_count from public.offline_activity_requests;
```

The geometry import is about 1.1 MB. To regenerate it locally without database
access or credentials:

```powershell
node scripts/prepare-te-araroa-import.mjs
```

The generator writes both a full SQL file (for direct database connections)
and six smaller data files plus setup/finalization (for SQL Editor). Do not
paste the JavaScript generator into SQL Editor. If a data query fails, rerun
it; the data files are replay-safe. Run finalization only after every data
part succeeds. After successful finalization, replay all data parts before
attempting another finalization. The empty, RLS-protected staging table is
retained for later imports and has no browser access.

## Schema decisions

- `trails` maps short codes to timezone, 100-meter tolerance, and current version.
- `trail_versions` retains the original GeoJSON and license. Published rows
  cannot be updated or deleted; corrections require a new version.
- `offline_activity_requests` retains parameters, timestamps, errors, and result
  references. Repeated numeric coordinates and local timestamp for the same
  owner/trail/path identify the same request, even after a trail version update.
  Timestamp calendar validity, daylight-saving ambiguity, endpoint snapping,
  and geometry correctness still require server validation in later steps.
- Each request has a generated bigint to use as the offline source activity ID.
  Existing Strava identifiers and uniqueness rules remain unchanged.
- Completed activities link to their request/version. A trigger checks that the
  source ID, owner, path, version, and hike time agree with the request.
- Requests and permissions are not publicly readable. Browser clients cannot
  write the new tables. The step 5 server handler validates the shared password
  and uses a fixed activity owner ID before processing a request.
- Geometry is publicly readable, consistent with the existing public trail asset.
- Replacement columns are reserved for step 8. **Do not populate them yet**:
  current map/progress queries do not filter superseded activities. No distance
  functions are changed in this foundation migration.

## Authorizing Ken (updated decision for step 5)

River chose shared-password links instead of Ken signing in. Ken needs no
Supabase account. Do not populate `offline_activity_submitters` for this mode.
Follow [OFFLINE_STEP5.md](OFFLINE_STEP5.md) for the new migration, password
secret, fixed activity owner ID, and Edge Function deployment. The foundation
migration's original sign-in-related comments describe the earlier proposal;
the step 5 implementation supersedes that authorization design.

## Validation limits

The generator validates coordinate structure/ranges and produces deterministic
SQL without credentials. Both generated SQL files passed PostgreSQL syntax
parsing, the three trigger functions passed PL/pgSQL syntax parsing, and the
imported JSON round-trip and SHA-256 were verified against the source asset.
PostgreSQL execution and RLS behavior must be checked
in Supabase: no local database server was available during preparation. If SQL
Editor reports an error, share the error text before proceeding to the import.
If applying migrations through the Supabase CLI later, reconcile this manually
applied migration with migration history rather than running it a second time.
