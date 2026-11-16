// Generates SQL locally; makes no network requests and needs no credentials.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const source = new URL('../public/TeAraroaTrail_2026_27.geojson', import.meta.url);
const feature = JSON.parse(await readFile(source, 'utf8'));
if (feature.type !== 'Feature' || feature.geometry?.type !== 'MultiLineString') {
  throw new Error('Expected Te Araroa Feature with MultiLineString geometry');
}
let vertices = 0;
for (const line of feature.geometry.coordinates) {
  if (!Array.isArray(line) || line.length < 2) throw new Error('Invalid trail section');
  for (const point of line) {
    if (!Array.isArray(point) || point.length < 2 || !point.every(Number.isFinite)
      || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) {
      throw new Error('Invalid WGS84 trail coordinate');
    }
    vertices++;
  }
}
const json = JSON.stringify(feature);
const hash = createHash('sha256').update(json).digest('hex');
const quote = (s) => "'" + s.replaceAll("'", "''") + "'";
// SQL standard string literals, including any future backslashes in metadata.
const sql = `-- Generated Te Araroa import. Run AFTER the foundation migration.
-- ${feature.geometry.coordinates.length} sections; ${vertices} vertices.
-- SHA-256 of compact JSON: ${hash}
begin;
set local standard_conforming_strings = on;
insert into public.trails (code, name, timezone)
values ('TA', 'Te Araroa', 'Pacific/Auckland') on conflict (code) do nothing;

do $import$
begin
  if exists (
    select 1 from public.trail_versions v join public.trails t on t.id = v.trail_id
    where t.code = 'TA' and v.version = '2026-27' and v.content_sha256 <> '${hash}'
  ) then
    raise exception 'Version 2026-27 already exists with different content; publish a new version.';
  end if;
end;
$import$;

insert into public.trail_versions
  (trail_id, version, geojson, content_sha256, source_filename, attribution, license)
select id, '2026-27', ${quote(json)}::jsonb, '${hash}',
  'TeAraroaTrail_2026_27.geojson', ${quote(feature.properties.copyright)}, ${quote(feature.properties.license)}
from public.trails where code = 'TA'
on conflict (trail_id, version) do nothing;

-- Do not reset an existing current version when replaying this initial import.
update public.trails t set current_version_id = v.id
from public.trail_versions v
where t.code = 'TA' and v.trail_id = t.id and v.version = '2026-27'
  and t.current_version_id is null;
commit;

select t.code, t.name, t.timezone, v.version,
  jsonb_array_length(v.geojson->'geometry'->'coordinates') as sections
from public.trails t join public.trail_versions v on v.id = t.current_version_id
where t.code = 'TA';
`;
const output = new URL('../supabase/imports/te-araroa-2026-27.sql', import.meta.url);
await mkdir(new URL('../supabase/imports/', import.meta.url), { recursive: true });
await writeFile(output, sql, 'utf8');
console.log(`Prepared ${output.pathname}: ${feature.geometry.coordinates.length} sections, ${vertices} vertices. No database changed.`);

// SQL Editor fallback: durable staging survives separate query connections.
const chunkDirectory = new URL('../supabase/imports/te-araroa-parts/', import.meta.url);
await mkdir(chunkDirectory, { recursive: true });
await writeFile(new URL('00-setup.sql', chunkDirectory), `-- Run once before the numbered data parts.
begin;
create table if not exists public.pfp_trail_import_chunks (
  import_id text not null,
  part integer not null check (part > 0),
  payload text not null,
  primary key (import_id, part)
);
alter table public.pfp_trail_import_chunks enable row level security;
revoke all on public.pfp_trail_import_chunks from public, anon, authenticated;
commit;
`, 'utf8');
const chunks = json.match(/[\s\S]{1,200000}/gu);
for (let index = 0; index < chunks.length; index++) {
  const number = String(index + 1).padStart(2, '0');
  await writeFile(new URL(`${number}-data.sql`, chunkDirectory), `-- Te Araroa data part ${index + 1} of ${chunks.length}. Safe to replay.
begin;
set local standard_conforming_strings = on;
insert into public.pfp_trail_import_chunks (import_id, part, payload)
values ('${hash}', ${index + 1}, ${quote(chunks[index])})
on conflict (import_id, part) do update set payload = excluded.payload;
commit;
`, 'utf8');
}
const assembled = `(select string_agg(payload, '' order by part) from public.pfp_trail_import_chunks where import_id = '${hash}')`;
const check = `
do $verify$
declare assembled text;
begin
  if (select count(*) from public.pfp_trail_import_chunks where import_id = '${hash}') <> ${chunks.length} then
    raise exception 'Missing data parts: run all ${chunks.length} numbered data files first.';
  end if;
  assembled := ${assembled};
  if encode(sha256(convert_to(assembled, 'UTF8')), 'hex') <> '${hash}' then
    raise exception 'Import checksum mismatch: rerun all data parts.';
  end if;
end;
$verify$;
`;
const finalSql = sql
  .replace('set local standard_conforming_strings = on;', 'set local standard_conforming_strings = on;\n' + check)
  .replace(quote(json) + '::jsonb', assembled + '::jsonb')
  .replace('commit;', `delete from public.pfp_trail_import_chunks where import_id = '${hash}';\ncommit;`);
await writeFile(new URL('99-finalize.sql', chunkDirectory), finalSql, 'utf8');
console.log(`SQL Editor alternative: 00-setup.sql, ${chunks.length} data files, then 99-finalize.sql in supabase/imports/te-araroa-parts/.`);
