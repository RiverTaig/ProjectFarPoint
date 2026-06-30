create or replace function public.pfp_activity_season(
  activity_started_at timestamptz
)
returns text
language sql
immutable
as $$
  with started_date as (
    select (extract(month from activity_started_at at time zone 'UTC')::integer * 100)
      + extract(day from activity_started_at at time zone 'UTC')::integer as month_day
  )
  select case
    when activity_started_at is null then null
    when month_day between 322 and 620 then 'spring'
    when month_day between 621 and 921 then 'summer'
    when month_day between 922 and 1220 then 'fall'
    else 'winter'
  end
  from started_date;
$$;

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
  new_season text;
begin
  new_line := public.pfp_activity_geometry_from_geojson(new_geometry_geojson);
  new_season := public.pfp_activity_season(new_started_at);

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
      and public.pfp_activity_season(started_at) = new_season
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
