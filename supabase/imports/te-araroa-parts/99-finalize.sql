-- Generated Te Araroa import. Run AFTER the foundation migration.
-- 466 sections; 28027 vertices.
-- SHA-256 of compact JSON: c815e5988c87caec418391cbdd3d5ad75c56fcc052b807a12e71db232bd722a6
begin;
set local standard_conforming_strings = on;

do $verify$
declare assembled text;
begin
  if (select count(*) from public.pfp_trail_import_chunks where import_id = 'c815e5988c87caec418391cbdd3d5ad75c56fcc052b807a12e71db232bd722a6') <> 6 then
    raise exception 'Missing data parts: run all 6 numbered data files first.';
  end if;
  assembled := (select string_agg(payload, '' order by part) from public.pfp_trail_import_chunks where import_id = 'c815e5988c87caec418391cbdd3d5ad75c56fcc052b807a12e71db232bd722a6');
  if encode(sha256(convert_to(assembled, 'UTF8')), 'hex') <> 'c815e5988c87caec418391cbdd3d5ad75c56fcc052b807a12e71db232bd722a6' then
    raise exception 'Import checksum mismatch: rerun all data parts.';
  end if;
end;
$verify$;

insert into public.trails (code, name, timezone)
values ('TA', 'Te Araroa', 'Pacific/Auckland') on conflict (code) do nothing;

do $import$
begin
  if exists (
    select 1 from public.trail_versions v join public.trails t on t.id = v.trail_id
    where t.code = 'TA' and v.version = '2026-27' and v.content_sha256 <> 'c815e5988c87caec418391cbdd3d5ad75c56fcc052b807a12e71db232bd722a6'
  ) then
    raise exception 'Version 2026-27 already exists with different content; publish a new version.';
  end if;
end;
$import$;

insert into public.trail_versions
  (trail_id, version, geojson, content_sha256, source_filename, attribution, license)
select id, '2026-27', (select string_agg(payload, '' order by part) from public.pfp_trail_import_chunks where import_id = 'c815e5988c87caec418391cbdd3d5ad75c56fcc052b807a12e71db232bd722a6')::jsonb, 'c815e5988c87caec418391cbdd3d5ad75c56fcc052b807a12e71db232bd722a6',
  'TeAraroaTrail_2026_27.geojson', 'Te Araroa Trust, 2026', 'Creative Commons 4.0 New Zealand'
from public.trails where code = 'TA'
on conflict (trail_id, version) do nothing;

-- Do not reset an existing current version when replaying this initial import.
update public.trails t set current_version_id = v.id
from public.trail_versions v
where t.code = 'TA' and v.trail_id = t.id and v.version = '2026-27'
  and t.current_version_id is null;
delete from public.pfp_trail_import_chunks where import_id = 'c815e5988c87caec418391cbdd3d5ad75c56fcc052b807a12e71db232bd722a6';
commit;

select t.code, t.name, t.timezone, v.version,
  jsonb_array_length(v.geojson->'geometry'->'coordinates') as sections
from public.trails t join public.trail_versions v on v.id = t.current_version_id
where t.code = 'TA';
