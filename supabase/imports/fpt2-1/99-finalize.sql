-- Requires existing offline activity migrations. Safe to replay.
begin;
set local standard_conforming_strings = on;
do $import$
declare assembled text; trail_id_value uuid; version_id_value uuid;
begin
  select string_agg(payload, '' order by part) into assembled
  from public.pfp_trail_import_chunks where import_id = 'b49ac8e87ccc12c55bae9d0c2f7d44a0a2406709cf723fa6532e1ff870f42a68';
  if (select count(*) from public.pfp_trail_import_chunks where import_id = 'b49ac8e87ccc12c55bae9d0c2f7d44a0a2406709cf723fa6532e1ff870f42a68') <> 2
     or assembled is null or encode(sha256(convert_to(assembled, 'UTF8')), 'hex') <> 'b49ac8e87ccc12c55bae9d0c2f7d44a0a2406709cf723fa6532e1ff870f42a68' then
    raise exception 'Missing or damaged data parts. Rerun all numbered data files.';
  end if;
  insert into public.trails (code, name, timezone)
  values ('FPT2', 'Far Point Trail — FPT_2 > Kananaskis', 'America/Edmonton')
  on conflict (code) do nothing;
  select id into trail_id_value from public.trails where code = 'FPT2' for update;
  if exists (select 1 from public.trails where id = trail_id_value and timezone <> 'America/Edmonton') then
    raise exception 'Existing segment timezone differs; review before importing.';
  end if;
  if exists (select 1 from public.trail_versions where trail_id = trail_id_value
      and version = '1' and geojson is distinct from assembled::jsonb) then
    raise exception 'Version already exists with different geometry. Use a new --version.';
  end if;
  insert into public.trail_versions
    (trail_id, version, geojson, content_sha256, source_filename, attribution, license)
  values (trail_id_value, '1', assembled::jsonb, 'b49ac8e87ccc12c55bae9d0c2f7d44a0a2406709cf723fa6532e1ff870f42a68',
    'FPT_2.gpx', 'OpenStreetMap contributors 2020', 'https://www.openstreetmap.org/copyright')
  on conflict (trail_id, version) do nothing;
  select id into version_id_value from public.trail_versions
  where trail_id = trail_id_value and version = '1';
  -- Replaying an old import must not roll back a later published version.
  update public.trails set current_version_id = version_id_value
  where id = trail_id_value and current_version_id is null;
end;
$import$;
-- Keep staging data so replaying finalize also succeeds.
commit;
select t.code, t.name, t.timezone, v.version from public.trails t
join public.trail_versions v on v.id = t.current_version_id where t.code = 'FPT2';
