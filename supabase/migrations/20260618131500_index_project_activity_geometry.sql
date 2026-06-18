create extension if not exists postgis with schema extensions;

alter table public.project_activities
  add column if not exists activity_geometry extensions.geometry(LineString, 4326);

create or replace function public.pfp_activity_geometry_from_geojson(
  geometry_geojson jsonb
)
returns extensions.geometry
language plpgsql
immutable
set search_path = public, extensions
as $$
begin
  if geometry_geojson is null
     or geometry_geojson->>'type' <> 'LineString'
     or jsonb_typeof(geometry_geojson->'coordinates') <> 'array' then
    return null;
  end if;

  return st_force2d(st_setsrid(st_geomfromgeojson(geometry_geojson::text), 4326));
end;
$$;

create or replace function public.pfp_sync_project_activity_geometry()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.activity_geometry := public.pfp_activity_geometry_from_geojson(new.geometry_geojson);
  return new;
end;
$$;

drop trigger if exists project_activities_sync_activity_geometry
  on public.project_activities;

create trigger project_activities_sync_activity_geometry
  before insert or update of geometry_geojson
  on public.project_activities
  for each row
  execute function public.pfp_sync_project_activity_geometry();

update public.project_activities
set activity_geometry = public.pfp_activity_geometry_from_geojson(geometry_geojson)
where geometry_geojson is not null
  and activity_geometry is null;

create index if not exists project_activities_voyager_activity_geometry_gix
  on public.project_activities
  using gist (activity_geometry)
  where pfp_type = 'Voyager'
    and activity_geometry is not null;

create index if not exists project_activities_voyager_started_at_idx
  on public.project_activities (started_at)
  where pfp_type = 'Voyager'
    and activity_geometry is not null;

create or replace function public.pfp_distance_made_good_km(
  new_geometry_geojson jsonb,
  new_started_at timestamptz,
  new_source text default 'strava',
  new_source_activity_id bigint default null,
  threshold_meters double precision default 15,
  new_distance_meters double precision default null
)
returns numeric
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  new_line geometry;
  previous_buffer geometry;
  uncovered_line geometry;
  total_geometry_meters double precision;
  uncovered_geometry_meters double precision;
  trusted_total_meters double precision;
  threshold_degrees double precision;
begin
  new_line := public.pfp_activity_geometry_from_geojson(new_geometry_geojson);

  if new_line is null then
    return null;
  end if;

  if st_isempty(new_line) then
    return 0;
  end if;

  total_geometry_meters := st_length(new_line::geography);

  if total_geometry_meters = 0 then
    return 0;
  end if;

  trusted_total_meters := case
    when new_distance_meters is not null and new_distance_meters > 0
      then new_distance_meters
    else total_geometry_meters
  end;
  threshold_degrees := threshold_meters / 111320.0;

  with nearby_previous_lines as (
    select activity_geometry as line
    from public.project_activities
    where pfp_type = 'Voyager'
      and activity_geometry is not null
      and activity_geometry && st_expand(new_line, threshold_degrees)
      and (
        new_started_at is null
        or started_at < new_started_at
      )
      and not (
        source = new_source
        and source_activity_id is not distinct from new_source_activity_id
      )
      and st_dwithin(activity_geometry::geography, new_line::geography, threshold_meters)
  )
  select st_unaryunion(
    st_collect(st_buffer(line::geography, threshold_meters)::geometry)
  )
  into previous_buffer
  from nearby_previous_lines;

  if previous_buffer is null or st_isempty(previous_buffer) then
    return round((trusted_total_meters / 1000)::numeric, 3);
  end if;

  uncovered_line := st_difference(new_line, previous_buffer);

  if uncovered_line is null or st_isempty(uncovered_line) then
    return 0;
  end if;

  uncovered_geometry_meters := st_length(uncovered_line::geography);

  return round(
    (
      trusted_total_meters
      * least(1, uncovered_geometry_meters / total_geometry_meters)
      / 1000
    )::numeric,
    3
  );
end;
$$;
