-- One-time setup for the signed-in owner's Import Trail GPX page.
begin;
create or replace function public.pfp_import_trail_gpx(
  p_filename text, p_version text, p_timezone text, p_geojson jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  segment text; trail_code text; trail_label text;
  trail_id_value uuid; version_id_value uuid; existing jsonb;
  shape extensions.geometry; point record; vertex_count integer;
  created boolean := false;
begin
  if not exists (select 1 from auth.users where id = auth.uid()
    and lower(email) = 'rivermadsen23@gmail.com' and email_confirmed_at is not null) then
    raise exception 'Only the Project Far Point owner can import trails.' using errcode = '42501';
  end if;
  if p_filename is null or length(p_filename) > 100 or p_filename !~* '^FPT_[0-9]+\.gpx$' then
    raise exception 'Use a file named FPT_<positive segment number>.gpx.';
  end if;
  segment := ltrim(substring(p_filename from '(?i)^FPT_([0-9]+)\.gpx$'), '0');
  trail_code := 'FPT' || segment;
  if segment = '' or length(trail_code) > 16 then raise exception 'Invalid FPT segment number.'; end if;
  if p_version is null or p_version !~ '^[A-Za-z0-9.-]{1,64}$' then raise exception 'Invalid version.'; end if;
  if p_timezone is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Choose a valid trail timezone.';
  end if;
  if p_geojson is null or octet_length(p_geojson::text) > 10000000
    or p_geojson->>'type' is distinct from 'Feature'
    or p_geojson->'geometry'->>'type' is distinct from 'MultiLineString'
    or jsonb_typeof(p_geojson->'properties') is distinct from 'object'
    or p_geojson->'properties'->>'code' is distinct from trail_code
    or p_geojson->'properties'->>'source' is distinct from p_filename then
    raise exception 'Invalid GPX trail geometry or metadata.';
  end if;
  trail_label := p_geojson->'properties'->>'name';
  if trail_label is null or length(trim(trail_label)) = 0 or length(trail_label) > 2000
    or p_geojson->'properties'->>'copyright' is null
    or p_geojson->'properties'->>'license' is null then raise exception 'Missing trail metadata.'; end if;
  shape := extensions.st_geomfromgeojson((p_geojson->'geometry')::text);
  vertex_count := extensions.st_npoints(shape);
  if extensions.st_isempty(shape) or not extensions.st_isvalid(shape)
    or extensions.st_ndims(shape) <> 2 or extensions.st_srid(shape) <> 4326
    or vertex_count < 2 or vertex_count > 250000 then raise exception 'Invalid trail geometry.'; end if;
  for point in select (extensions.st_dumppoints(shape)).geom as geom loop
    if not (extensions.st_x(point.geom) between -180 and 180
      and extensions.st_y(point.geom) between -90 and 90) then
      raise exception 'Coordinates must be finite WGS84 longitude and latitude.';
    end if;
  end loop;
  insert into public.trails (code,name,timezone)
  values (trail_code,'Far Point Trail — ' || trail_label,p_timezone)
  on conflict (code) do nothing;
  select id into trail_id_value from public.trails where code=trail_code for update;
  if exists (select 1 from public.trails where id=trail_id_value and timezone<>p_timezone) then
    raise exception 'Existing segment timezone differs. Use its registered timezone.';
  end if;
  select id,geojson into version_id_value,existing from public.trail_versions
    where trail_id=trail_id_value and version=p_version;
  if version_id_value is not null then
    if existing is distinct from p_geojson then
      raise exception 'This version already contains different geometry. Choose a new version.';
    end if;
  else
    insert into public.trail_versions
      (trail_id,version,geojson,content_sha256,source_filename,attribution,license)
    values (trail_id_value,p_version,p_geojson,
      encode(sha256(convert_to(p_geojson::text,'UTF8')),'hex'),p_filename,
      p_geojson->'properties'->>'copyright',p_geojson->'properties'->>'license')
    returning id into version_id_value;
    created := true;
  end if;
  -- Publish new imports. Replaying an older version never rolls back a newer one.
  update public.trails set current_version_id=version_id_value
    where id=trail_id_value and (created or current_version_id is null);
  return jsonb_build_object('status',case when created then 'imported' else 'already_imported' end,
    'code',trail_code,'version',p_version,'vertices',vertex_count,
    'current',exists(select 1 from public.trails where id=trail_id_value and current_version_id=version_id_value));
end;
$$;
revoke all on function public.pfp_import_trail_gpx(text,text,text,jsonb) from public,anon;
grant execute on function public.pfp_import_trail_gpx(text,text,text,jsonb) to authenticated;
commit;
