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
begin
  if new_geometry_geojson is null
     or new_geometry_geojson->>'type' <> 'LineString'
     or jsonb_typeof(new_geometry_geojson->'coordinates') <> 'array' then
    return null;
  end if;

  new_line := st_force2d(st_setsrid(st_geomfromgeojson(new_geometry_geojson::text), 4326));

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

  with previous_lines as (
    select st_force2d(st_setsrid(st_geomfromgeojson(geometry_geojson::text), 4326)) as line
    from public.project_activities
    where pfp_type = 'Voyager'
      and geometry_geojson is not null
      and (
        new_started_at is null
        or started_at < new_started_at
      )
      and not (
        source = new_source
        and source_activity_id is not distinct from new_source_activity_id
      )
  ),
  nearby_previous_lines as (
    select line
    from previous_lines
    where st_dwithin(line::geography, new_line::geography, threshold_meters)
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
    (trusted_total_meters * least(1, uncovered_geometry_meters / total_geometry_meters) / 1000)::numeric,
    3
  );
end;
$$;
