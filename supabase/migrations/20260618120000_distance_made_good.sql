create or replace function public.pfp_point_segment_distance_meters(
  point_lon double precision,
  point_lat double precision,
  segment_start_lon double precision,
  segment_start_lat double precision,
  segment_end_lon double precision,
  segment_end_lat double precision
)
returns double precision
language plpgsql
immutable
as $$
declare
  earth_radius_meters constant double precision := 6371008.8;
  start_x double precision;
  start_y double precision;
  end_x double precision;
  end_y double precision;
  segment_x double precision;
  segment_y double precision;
  segment_length_squared double precision;
  projection double precision;
  closest_x double precision;
  closest_y double precision;
begin
  start_x := radians(segment_start_lon - point_lon)
    * earth_radius_meters
    * cos(radians(point_lat));
  start_y := radians(segment_start_lat - point_lat) * earth_radius_meters;
  end_x := radians(segment_end_lon - point_lon)
    * earth_radius_meters
    * cos(radians(point_lat));
  end_y := radians(segment_end_lat - point_lat) * earth_radius_meters;
  segment_x := end_x - start_x;
  segment_y := end_y - start_y;
  segment_length_squared := segment_x * segment_x + segment_y * segment_y;

  if segment_length_squared = 0 then
    return sqrt(start_x * start_x + start_y * start_y);
  end if;

  projection := greatest(
    0,
    least(1, -(start_x * segment_x + start_y * segment_y) / segment_length_squared)
  );
  closest_x := start_x + projection * segment_x;
  closest_y := start_y + projection * segment_y;

  return sqrt(closest_x * closest_x + closest_y * closest_y);
end;
$$;

create or replace function public.pfp_point_near_geometry(
  point_lon double precision,
  point_lat double precision,
  geometry_geojson jsonb,
  threshold_meters double precision default 15
)
returns boolean
language plpgsql
stable
as $$
declare
  coordinate jsonb;
  previous_lon double precision;
  previous_lat double precision;
  lon double precision;
  lat double precision;
begin
  if geometry_geojson is null
     or geometry_geojson->>'type' <> 'LineString'
     or jsonb_typeof(geometry_geojson->'coordinates') <> 'array' then
    return false;
  end if;

  for coordinate in
    select value
    from jsonb_array_elements(geometry_geojson->'coordinates')
  loop
    lon := (coordinate->>0)::double precision;
    lat := (coordinate->>1)::double precision;

    if previous_lon is not null
       and public.pfp_point_segment_distance_meters(
         point_lon,
         point_lat,
         previous_lon,
         previous_lat,
         lon,
         lat
       ) <= threshold_meters then
      return true;
    end if;

    previous_lon := lon;
    previous_lat := lat;
  end loop;

  return false;
end;
$$;

create or replace function public.pfp_segment_uncovered_distance_meters(
  segment_start_lon double precision,
  segment_start_lat double precision,
  segment_end_lon double precision,
  segment_end_lat double precision,
  previous_geometries jsonb[],
  threshold_meters double precision default 15
)
returns double precision
language plpgsql
stable
as $$
declare
  segment_length_meters double precision;
  sample_count integer;
  sample_index integer;
  sample_fraction double precision;
  sample_lon double precision;
  sample_lat double precision;
  previous_geometry jsonb;
  is_covered boolean;
  uncovered_meters double precision := 0;
begin
  segment_length_meters := public.pfp_distance_meters(
    segment_start_lon,
    segment_start_lat,
    segment_end_lon,
    segment_end_lat
  );

  if segment_length_meters = 0 then
    return 0;
  end if;

  if previous_geometries is null or coalesce(array_length(previous_geometries, 1), 0) = 0 then
    return segment_length_meters;
  end if;

  sample_count := greatest(1, ceil(segment_length_meters / greatest(1, threshold_meters / 2))::integer);

  for sample_index in 0..sample_count - 1 loop
    sample_fraction := (sample_index + 0.5) / sample_count;
    sample_lon := segment_start_lon + (segment_end_lon - segment_start_lon) * sample_fraction;
    sample_lat := segment_start_lat + (segment_end_lat - segment_start_lat) * sample_fraction;
    is_covered := false;

    foreach previous_geometry in array previous_geometries loop
      if public.pfp_point_near_geometry(
        sample_lon,
        sample_lat,
        previous_geometry,
        threshold_meters
      ) then
        is_covered := true;
        exit;
      end if;
    end loop;

    if not is_covered then
      uncovered_meters := uncovered_meters + segment_length_meters / sample_count;
    end if;
  end loop;

  return uncovered_meters;
end;
$$;

create or replace function public.pfp_distance_made_good_km(
  new_geometry_geojson jsonb,
  new_started_at timestamptz,
  new_source text default 'strava',
  new_source_activity_id bigint default null,
  threshold_meters double precision default 15
)
returns numeric
language plpgsql
stable
as $$
declare
  previous_geometries jsonb[];
  coordinate jsonb;
  previous_lon double precision;
  previous_lat double precision;
  lon double precision;
  lat double precision;
  total_meters double precision := 0;
begin
  if new_geometry_geojson is null
     or new_geometry_geojson->>'type' <> 'LineString'
     or jsonb_typeof(new_geometry_geojson->'coordinates') <> 'array' then
    return null;
  end if;

  select coalesce(array_agg(geometry_geojson), array[]::jsonb[])
  into previous_geometries
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
    );

  for coordinate in
    select value
    from jsonb_array_elements(new_geometry_geojson->'coordinates')
  loop
    lon := (coordinate->>0)::double precision;
    lat := (coordinate->>1)::double precision;

    if previous_lon is not null then
      total_meters := total_meters + public.pfp_segment_uncovered_distance_meters(
        previous_lon,
        previous_lat,
        lon,
        lat,
        previous_geometries,
        threshold_meters
      );
    end if;

    previous_lon := lon;
    previous_lat := lat;
  end loop;

  return round((total_meters / 1000)::numeric, 3);
end;
$$;
