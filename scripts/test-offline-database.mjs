// Isolated PostgreSQL/PostGIS tests. Installs no schema in remote Supabase.
// Dependencies may be installed separately from the app; see OFFLINE_STEP5.md.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { buildTrailIndex, extractTrailSection } from '../supabase/functions/_shared/trailExtraction.ts';
import { resolveLocalDateTime } from '../supabase/functions/_shared/offlineSubmission.ts';
import { previewExamples } from '../src/offline/previewExamples.ts';

const moduleRoot = process.env.PFP_SQL_TEST_MODULE_ROOT ?? join(tmpdir(), 'pfp-offline-db-test');
const require = createRequire(join(moduleRoot, 'package.json'));
const { PGlite } = require('@electric-sql/pglite');
const { postgis } = require('@electric-sql/pglite-postgis');
const pg = new PGlite({ extensions: { postgis } });
const root = new URL('../', import.meta.url);
const owner = '11111111-1111-4111-8111-111111111111';
const sqlFile = (name) => readFileSync(new URL(`supabase/migrations/${name}`, root), 'utf8');
const scalar = async (sql, args = []) => (await pg.query(sql, args)).rows[0].result;
const rpc = (name, args) => scalar(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as result`, args);
const count = () => scalar("select count(*)::integer as result from public.project_activities where source='offline'");
const check = (name) => console.log('PASS', name);
try {
  await pg.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema extensions;
    create schema storage;
    create table storage.buckets (id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects (id uuid primary key,name text,bucket_id text);
    alter table storage.objects enable row level security;
    create function storage.foldername(path text) returns text[] language sql immutable as $$select string_to_array(path,'/')$$;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth,extensions to anon,authenticated,service_role;
    insert into auth.users values ('${owner}');
  `);
  for (const name of [
    '20260604195000_strava_activity_import.sql',
    '20260604213000_project_activity_metadata.sql',
    '20260604215500_project_activity_text_description.sql',
    '20260618131500_index_project_activity_geometry.sql',
    '20260620180000_distance_made_good_same_season.sql',
    '20260621100000_project_activity_strava_links.sql',
    '20260618133000_project_activity_images.sql',
    '20261115120000_offline_activity_foundation.sql',
    '20261115130000_offline_activity_processing.sql',
    '20261116120000_offline_activity_content.sql',
    '20261116130000_offline_request_delete_with_activity.sql',
  ]) await pg.exec(sqlFile(name));
  // Supabase supplies existing table privileges through its default grants.
  await pg.exec('grant all on public.project_activities,public.project_activity_images to service_role;');
  await pg.exec(readFileSync(new URL('supabase/imports/te-araroa-2026-27.sql', root), 'utf8'));
  check('actual migrations and Te Araroa import execute successfully');
  const trail = await scalar("select id as result from public.trails where code='TA'");
  const originalVersion = await scalar("select current_version_id as result from public.trails where code='TA'");
  const feature = JSON.parse(readFileSync(new URL('public/TeAraroaTrail_2026_27.geojson', root), 'utf8'));
  const index = buildTrailIndex(feature);
  const input = Object.fromEntries(new URLSearchParams(previewExamples[0].query));
  const start = input.s.split(',').map(Number), end = input.e.split(',').map(Number);
  const section = extractTrailSection(index, start, end);
  const geometry = JSON.stringify(section.geometry);
  const prepare = (date, path = 'Voyager') => rpc('pfp_prepare_offline_request', [owner, trail, path, date,
    resolveLocalDateTime(date, 'Pacific/Auckland'), ...start, ...end]);
  const complete = (claim, shape = geometry) => rpc('pfp_complete_offline_request', [claim.request.id, claim.request.processing_token, shape]);

  await pg.exec('set role service_role;');
  const first = await prepare('20261205T0800');
  assert.equal(first.state, 'claimed');
  assert.equal((await prepare('20261205T0800')).state, 'processing');
  const done = await complete(first);
  assert.equal(done.status, 'completed'); assert.ok(done.distanceMeters > 24000 && done.distanceMeters < 25000);
  assert.equal(done.appliesTo, 'Voyager'); assert.ok(done.creditedKilometers > 24);
  assert.equal((await prepare('20261205T0800')).result.activityId, done.activityId);
  assert.equal((await complete(first)).status, 'already_processed');
  assert.equal(await count(), 1);
  check('claim, duplicate in progress, atomic completion, and completed retries');

  const beforeContent = await scalar('select distance_made_good as result from public.project_activities where id=$1',[done.activityId]);
  await rpc('pfp_save_offline_content',[first.request.id,owner,'Day on the trail.\n\n{Image name="camp"}',null]);
  assert.equal(await scalar('select text_description as result from public.project_activities where id=$1',[done.activityId]),'Day on the trail.\n\n{Image name="camp"}');
  const image = {name:'camp',storage_path:`${done.activityId}/offline/camp-${'a'.repeat(64)}.jpg`,caption:'Campsite',content_type:'image/jpeg',size_bytes:1234,sort_order:0};
  await rpc('pfp_save_offline_content',[first.request.id,owner,null,JSON.stringify(image)]);
  await rpc('pfp_save_offline_content',[first.request.id,owner,null,JSON.stringify(image)]);
  assert.equal(await scalar('select count(*)::integer as result from public.project_activity_images where activity_id=$1',[done.activityId]),1);
  await assert.rejects(rpc('pfp_save_offline_content',[first.request.id,owner,null,JSON.stringify({...image,storage_path:image.storage_path.replace('a'.repeat(64),'b'.repeat(64))})]),/IMAGE_NAME_IN_USE/);
  await assert.rejects(rpc('pfp_save_offline_content',[first.request.id,'22222222-2222-4222-8222-222222222222','wrong owner',null]),/OFFLINE_ACTIVITY_NOT_FOUND/);
  for(let n=1;n<10;n++) await rpc('pfp_save_offline_content',[first.request.id,owner,null,JSON.stringify({...image,name:`photo${n}`,storage_path:image.storage_path.replace('/camp-','/photo'+n+'-')})]);
  await assert.rejects(rpc('pfp_save_offline_content',[first.request.id,owner,null,JSON.stringify({...image,name:'extra',storage_path:image.storage_path.replace('/camp-','/extra-')})]),/IMAGE_LIMIT_REACHED/);
  assert.equal(await scalar('select distance_made_good as result from public.project_activities where id=$1',[done.activityId]),beforeContent);
  assert.equal(await count(),1);
  check('offline description and images: owner scope, retry deduplication, name collisions, ten-photo limit, no progress changes');

  const failed = await prepare('20261206T0800');
  await assert.rejects(complete(failed, JSON.stringify({ type: 'LineString', coordinates: [[0,0],[.1,0]] })), /snapping tolerance/);
  assert.equal(await count(), 1);
  await rpc('pfp_fail_offline_request', [failed.request.id, failed.request.processing_token, 'TEST_FAILURE', 'retryable']);
  const retried = await prepare('20261206T0800');
  assert.notEqual(retried.request.processing_token, failed.request.processing_token);
  await assert.rejects(complete(failed), /claim has expired/);
  await rpc('pfp_fail_offline_request', [failed.request.id, failed.request.processing_token, 'STALE', 'must not overwrite']);
  assert.equal(await scalar('select status as result from public.offline_activity_requests where id=$1', [failed.request.id]), 'processing');
  await complete(retried);
  check('invalid geometry rolls back; failed requests retry; old claims cannot complete or overwrite');

  const later = await prepare('20270108T0800'); const laterDone = await complete(later);
  assert.ok(laterDone.creditedKilometers > 24);
  const earlier = await prepare('20270107T0800'); const earlierDone = await complete(earlier);
  assert.ok(earlierDone.creditedKilometers > 24);
  assert.equal(Number(await scalar('select distance_made_good as result from public.project_activities where id=$1',[laterDone.activityId])), 0);
  const result = await prepare('20270108T0800');
  assert.equal(result.result.creditedKilometers, 0);
  check('backdated Voyager report recalculates later seasonal credit and duplicate response');

  const fp1 = await complete(await prepare('20261212T0800','Far Point Trail'));
  const fp2 = await complete(await prepare('20261213T0800','Far Point Trail'));
  assert.ok(fp1.creditedKilometers > 24); assert.equal(fp2.creditedKilometers, 0);
  check('Far Point Trail credits full first hike and no repeat geometry');

  const lease = await prepare('20270201T0800');
  await pg.query("update public.offline_activity_requests set processing_started_at=now()-interval '6 minutes' where id=$1",[lease.request.id]);
  const renewed = await prepare('20270201T0800');
  assert.notEqual(lease.request.processing_token, renewed.request.processing_token);
  await assert.rejects(complete(lease), /claim has expired/);
  await complete(renewed);
  check('interrupted processing can reclaim an expired lease without duplication');

  assert.equal(await scalar("select count(*)::integer as result from public.offline_activity_requests where original_parameters ? 'pw'"), 0);
  assert.equal(await scalar("select count(*)::integer as result from public.offline_activity_requests where submitted_by is not null or authentication_method <> 'shared_password'"), 0);
  check('no password persisted; shared-password submissions do not pretend to be signed-in users');

  await pg.exec('reset role;');
  await pg.exec(`insert into public.trail_versions (trail_id,version,geojson,content_sha256,source_filename,attribution,license)
    select trail_id,'test-next-version',geojson,content_sha256,source_filename,attribution,license
    from public.trail_versions where version='2026-27';
    update public.trails set current_version_id=(select id from public.trail_versions where version='test-next-version') where code='TA';`);
  const original = await prepare('20261205T0800');
  assert.equal(original.result.trailVersion,'2026-27');
  assert.equal(await scalar('select trail_version_id as result from public.offline_activity_requests where id=$1',[first.request.id]),originalVersion);
  await assert.rejects(pg.exec("update public.trail_versions set version='oops' where version='2026-27'"), /immutable/);
  check('trail updates preserve request version and immutable geometry');

  for (const role of ['anon','authenticated']) {
    await pg.exec(`set role ${role};`);
    await assert.rejects(prepare('20261205T0800'), /permission denied/);
    await assert.rejects(rpc('pfp_save_offline_content',[first.request.id,owner,'unauthorized',null]),/permission denied/);
    if (role === 'anon') await assert.rejects(pg.exec('select * from public.offline_activity_requests'), /permission denied/);
    else assert.equal((await pg.query('select * from public.offline_activity_requests')).rows.length, 0);
    assert.equal((await pg.query('select code from public.trails')).rows.length,1);
    await assert.rejects(pg.exec("insert into public.trails (code,name,timezone) values ('BAD','bad','UTC')"),/permission denied/);
    await pg.exec('reset role;');
  }
  check('anonymous and signed-in clients cannot call write RPCs; private requests stay private');
  await pg.exec('set role service_role;');
  await pg.query('delete from public.project_activities where id=$1',[done.activityId]);
  assert.equal(await scalar('select count(*)::integer as result from public.offline_activity_requests where id=$1',[first.request.id]),0);
  assert.equal(await scalar('select count(*)::integer as result from public.project_activity_images where activity_id=$1',[done.activityId]),0);
  const replacement = await prepare('20261205T0800');
  assert.equal(replacement.state,'claimed');assert.notEqual(replacement.request.id,first.request.id);
  await complete(replacement);
  check('deleting activity cascades its request and image metadata despite circular references; deliberate resubmission works');
  await pg.exec('reset role; grant select,delete on public.project_activities to authenticated;');
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  await pg.exec('set role authenticated;');
  await pg.query('delete from public.project_activities where id=$1',[fp1.activityId]);
  await pg.exec('reset role;');
  assert.equal(await scalar('select count(*)::integer as result from public.offline_activity_requests where result_activity_id=$1',[fp1.activityId]),0);
  assert.equal(await scalar('select count(*)::integer as result from public.project_activities where id=$1',[fp1.activityId]),0);
  check('owner deletion also cascades without granting direct request deletion permissions');
  console.log('All isolated PostgreSQL/PostGIS checks passed. No remote database accessed.');
} finally { await pg.close(); }
