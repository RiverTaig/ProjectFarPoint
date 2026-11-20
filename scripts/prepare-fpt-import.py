"""Prepare immutable Supabase trail imports, optionally uploading them.

Usage: python scripts/prepare-fpt-import.py FPT_1.gpx [FPT_2.gpx ...]
Use --timezone and --version when publishing a different region or revision.
Add --upload to execute the generated SQL against Supabase.
"""
import argparse
import getpass
import hashlib
import json
import math
import os
import re
import sys
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]


def quote(value):
    return "'" + value.replace("'", "''") + "'"


def prepare(source, timezone, version):
    match = re.fullmatch(r"FPT_(\d+)\.gpx", source.name, re.I)
    if not match or int(match[1]) < 1:
        raise ValueError("Expected FPT_<positive segment number>.gpx")
    code = f"FPT{int(match[1])}"
    if len(code) > 16:
        raise ValueError("Segment code exceeds database limit")
    tree = ET.parse(source).getroot()
    # Namespace-independent GPX 1.0/1.1 tracks and routes. Never bridge gaps.
    lines = []
    for section in list(tree.findall('.//{*}trkseg')) + list(tree.findall('./{*}rte')):
        points = []
        for point in section:
            if point.tag.split('}')[-1] not in ('trkpt', 'rtept'):
                continue
            lon, lat = float(point.attrib['lon']), float(point.attrib['lat'])
            if not (math.isfinite(lon) and math.isfinite(lat) and abs(lon) <= 180 and abs(lat) <= 90):
                raise ValueError('Invalid WGS84 coordinate')
            if not points or points[-1] != [lon, lat]:
                points.append([lon, lat])
        if len(points) < 2:
            raise ValueError('Each GPX section needs at least two distinct points')
        lines.append(points)
    if not lines:
        raise ValueError('No GPX track or route sections found')
    metadata = tree.find('./{*}metadata')
    if metadata is None:
        metadata = tree
    def text(path, fallback):
        return metadata.findtext(path, fallback) or fallback
    name = text('./{*}name', code)
    attribution = text('./{*}copyright/{*}year', '')
    copyright_node = metadata.find('./{*}copyright') if metadata is not None else None
    attribution = ' '.join(filter(None, [copyright_node.get('author', '') if copyright_node is not None else '', attribution])) or 'Source GPX'
    license_text = text('./{*}copyright/{*}license', 'See source GPX')
    feature = {'type': 'Feature', 'properties': {'name': name, 'source': source.name,
               'code': code, 'description': text('./{*}desc', ''),
               'copyright': attribution, 'license': license_text},
               'geometry': {'type': 'MultiLineString', 'coordinates': lines}}
    payload = json.dumps(feature, separators=(',', ':'), ensure_ascii=True)
    digest = hashlib.sha256(payload.encode()).hexdigest()
    directory = ROOT / 'supabase' / 'imports' / f'{code.lower()}-{version}'
    directory.mkdir(parents=True, exist_ok=True)
    # Small durable SQL Editor parts, following the Te Araroa import convention.
    chunks = [payload[i:i+150000] for i in range(0, len(payload), 150000)]
    (directory / '00-setup.sql').write_text('''begin;
create table if not exists public.pfp_trail_import_chunks (
  import_id text not null, part integer not null check (part > 0),
  payload text not null, primary key (import_id, part)
);
alter table public.pfp_trail_import_chunks enable row level security;
revoke all on public.pfp_trail_import_chunks from public, anon, authenticated;
commit;
''', encoding='utf-8')
    for number, chunk in enumerate(chunks, 1):
        (directory / f'{number:02}-data.sql').write_text(f'''begin;
set local standard_conforming_strings = on;
insert into public.pfp_trail_import_chunks (import_id, part, payload)
values ('{digest}', {number}, {quote(chunk)})
on conflict (import_id, part) do update set payload = excluded.payload;
commit;
''', encoding='utf-8')
    (directory / '99-finalize.sql').write_text(f'''-- Requires existing offline activity migrations. Safe to replay.
begin;
set local standard_conforming_strings = on;
do $import$
declare assembled text; trail_id_value uuid; version_id_value uuid;
begin
  select string_agg(payload, '' order by part) into assembled
  from public.pfp_trail_import_chunks where import_id = '{digest}';
  if (select count(*) from public.pfp_trail_import_chunks where import_id = '{digest}') <> {len(chunks)}
     or assembled is null or encode(sha256(convert_to(assembled, 'UTF8')), 'hex') <> '{digest}' then
    raise exception 'Missing or damaged data parts. Rerun all numbered data files.';
  end if;
  insert into public.trails (code, name, timezone)
  values ({quote(code)}, {quote('Far Point Trail — ' + name)}, {quote(timezone)})
  on conflict (code) do nothing;
  select id into trail_id_value from public.trails where code = {quote(code)} for update;
  if exists (select 1 from public.trails where id = trail_id_value and timezone <> {quote(timezone)}) then
    raise exception 'Existing segment timezone differs; review before importing.';
  end if;
  if exists (select 1 from public.trail_versions where trail_id = trail_id_value
      and version = {quote(version)} and geojson is distinct from assembled::jsonb) then
    raise exception 'Version already exists with different geometry. Use a new --version.';
  end if;
  insert into public.trail_versions
    (trail_id, version, geojson, content_sha256, source_filename, attribution, license)
  values (trail_id_value, {quote(version)}, assembled::jsonb, '{digest}',
    {quote(source.name)}, {quote(attribution)}, {quote(license_text)})
  on conflict (trail_id, version) do nothing;
  select id into version_id_value from public.trail_versions
  where trail_id = trail_id_value and version = {quote(version)};
  -- Replaying an old import must not roll back a later published version.
  update public.trails set current_version_id = version_id_value
  where id = trail_id_value and current_version_id is null;
end;
$import$;
-- Keep staging data so replaying finalize also succeeds.
commit;
select t.code, t.name, t.timezone, v.version from public.trails t
join public.trail_versions v on v.id = t.current_version_id where t.code = {quote(code)};
''', encoding='utf-8')
    # Local fixture for extraction tests, not a frontend fallback.
    (directory / 'geometry.geojson').write_text(payload + '\n', encoding='utf-8')
    start, end = lines[0][0], lines[0][-1]
    (directory / 'offline-example.txt').write_text(
        f'https://projectfarpoint.com/offline?t={code}&p=F&dt=20260715T0800'
        f'&s={start[0]},{start[1]}&e={end[0]},{end[1]}&preview=1\n', encoding='utf-8')
    print(f'{code}: {len(lines)} sections, {sum(map(len, lines))} vertices. Prepared SQL in {directory}.')
    return [directory / '00-setup.sql',
            *[directory / f'{number:02}-data.sql' for number in range(1, len(chunks) + 1)],
            directory / '99-finalize.sql']


def database_url():
    """Credentials stay out of command arguments, browser config and source control."""
    value = os.environ.get('SUPABASE_DB_URL', '').strip()
    config = ROOT / '.env.fpt-import'
    if not value and config.exists():
        for line in config.read_text(encoding='utf-8-sig').splitlines():
            if line.strip().startswith('SUPABASE_DB_URL='):
                value = line.strip().split('=', 1)[1].strip()
                if len(value) > 1 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                break
    if not value:
        if not sys.stdin.isatty():
            raise RuntimeError('Set SUPABASE_DB_URL or add it to .env.fpt-import before using --upload.')
        value = getpass.getpass('Supabase PostgreSQL connection URI (hidden): ').strip()
    if not value.startswith(('postgres://', 'postgresql://')):
        raise RuntimeError('Use a PostgreSQL connection URI from Supabase Connect, not the website URL or API key.')
    return value


def upload(plans, connection_uri, connect=None):
    if connect is None:
        try:
            import psycopg
        except ImportError:
            raise RuntimeError('Install the upload driver first: python -m pip install -r scripts/requirements-fpt.txt') from None
        connect = psycopg.connect
    # Each generated file owns its BEGIN/COMMIT. Stop on the first error;
    # committed chunks can be replayed and publication occurs only in finalize.
    try:
        with connect(connection_uri, autocommit=True, sslmode='require', connect_timeout=20) as connection:
            for files in plans:
                for file in files:
                    print(f'Uploading {file.parent.name}/{file.name}...')
                    with connection.cursor() as cursor:
                        cursor.execute(file.read_text(encoding='utf-8'), prepare=False)
                        while True:
                            if cursor.description:
                                for row in cursor.fetchall():
                                    print('Published:', ' | '.join(str(value) for value in row))
                            if not cursor.nextset():
                                break
        print('Upload complete. Refresh the app to load the published segments.')
    except Exception as error:
        # A driver connection exception may include credentials; never echo it.
        detail = getattr(getattr(error, 'diag', None), 'message_primary', None)
        message = 'Upload stopped. Check the connection URI, database password, and existing offline migrations.'
        if detail:
            message += ' Database: ' + detail.replace(connection_uri, '[connection hidden]')
        raise RuntimeError(message + ' It is safe to rerun the same command after fixing the issue.') from None


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('sources', nargs='+', type=Path)
    parser.add_argument('--timezone', default='America/Edmonton')
    parser.add_argument('--version', default='1')
    parser.add_argument('--upload', action='store_true', help='Execute generated SQL using SUPABASE_DB_URL or a hidden connection URI prompt')
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9.-]+', args.version):
        parser.error('Version must use letters, digits, dots, or hyphens')
    try:
        plans = [prepare(source, args.timezone, args.version) for source in args.sources]
        if args.upload:
            upload(plans, database_url())
        else:
            print('SQL prepared only; nothing uploaded. Add --upload to import automatically.')
    except (OSError, ValueError, ET.ParseError, RuntimeError) as error:
        parser.exit(1, f'Error: {error}\n')
