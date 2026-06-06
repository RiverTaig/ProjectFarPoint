create or replace function public.pfp_distance_meters(
  lon1 double precision,
  lat1 double precision,
  lon2 double precision,
  lat2 double precision
)
returns double precision
language sql
immutable
as $$
  select 2 * 6371008.8 * asin(
    least(
      1,
      sqrt(
        power(sin(radians(lat2 - lat1) / 2), 2)
        + cos(radians(lat1))
        * cos(radians(lat2))
        * power(sin(radians(lon2 - lon1) / 2), 2)
      )
    )
  );
$$;

create or replace function public.pfp_corrected_activity_distance_km(
  geometry_geojson jsonb,
  loop_tolerance_meters double precision default 30,
  min_loop_points integer default 6,
  min_loop_distance_meters double precision default 50
)
returns numeric
language plpgsql
stable
as $$
declare
  coordinate jsonb;
  lon double precision;
  lat double precision;
  accepted_lons double precision[] := '{}';
  accepted_lats double precision[] := '{}';
  accepted_count integer := 0;
  candidate_index integer;
  loop_length_meters double precision;
  total_meters double precision := 0;
  i integer;
begin
  if geometry_geojson is null
     or geometry_geojson->>'type' <> 'LineString'
     or jsonb_typeof(geometry_geojson->'coordinates') <> 'array' then
    return null;
  end if;

  for coordinate in
    select value
    from jsonb_array_elements(geometry_geojson->'coordinates')
  loop
    lon := (coordinate->>0)::double precision;
    lat := (coordinate->>1)::double precision;
    accepted_count := coalesce(array_length(accepted_lons, 1), 0);
    candidate_index := null;

    if accepted_count >= min_loop_points + 1 then
      for i in reverse accepted_count - min_loop_points..1 loop
        if public.pfp_distance_meters(
          accepted_lons[i],
          accepted_lats[i],
          lon,
          lat
        ) <= loop_tolerance_meters then
          candidate_index := i;
          exit;
        end if;
      end loop;
    end if;

    if candidate_index is not null then
      loop_length_meters := 0;

      if candidate_index < accepted_count then
        for i in candidate_index..accepted_count - 1 loop
          loop_length_meters := loop_length_meters + public.pfp_distance_meters(
            accepted_lons[i],
            accepted_lats[i],
            accepted_lons[i + 1],
            accepted_lats[i + 1]
          );
        end loop;
      end if;

      loop_length_meters := loop_length_meters + public.pfp_distance_meters(
        accepted_lons[accepted_count],
        accepted_lats[accepted_count],
        lon,
        lat
      );

      if loop_length_meters >= min_loop_distance_meters then
        accepted_lons := accepted_lons[1:candidate_index];
        accepted_lats := accepted_lats[1:candidate_index];
      end if;
    end if;

    accepted_lons := array_append(accepted_lons, lon);
    accepted_lats := array_append(accepted_lats, lat);
  end loop;

  accepted_count := coalesce(array_length(accepted_lons, 1), 0);

  if accepted_count < 2 then
    return 0;
  end if;

  for i in 1..accepted_count - 1 loop
    total_meters := total_meters + public.pfp_distance_meters(
      accepted_lons[i],
      accepted_lats[i],
      accepted_lons[i + 1],
      accepted_lats[i + 1]
    );
  end loop;

  return round((total_meters / 1000)::numeric, 3);
end;
$$;

create or replace function public.pfp_geometry_distance_km(
  geometry_geojson jsonb
)
returns numeric
language plpgsql
stable
as $$
declare
  coordinate jsonb;
  previous_lon double precision;
  previous_lat double precision;
  lon double precision;
  lat double precision;
  total_meters double precision := 0;
begin
  if geometry_geojson is null
     or geometry_geojson->>'type' <> 'LineString'
     or jsonb_typeof(geometry_geojson->'coordinates') <> 'array' then
    return null;
  end if;

  for coordinate in
    select value
    from jsonb_array_elements(geometry_geojson->'coordinates')
  loop
    lon := (coordinate->>0)::double precision;
    lat := (coordinate->>1)::double precision;

    if previous_lon is not null and previous_lat is not null then
      total_meters := total_meters + public.pfp_distance_meters(
        previous_lon,
        previous_lat,
        lon,
        lat
      );
    end if;

    previous_lon := lon;
    previous_lat := lat;
  end loop;

  return round((total_meters / 1000)::numeric, 3);
end;
$$;

-- Preview the existing values against the proposed corrected distance before updating.
select
  id,
  name,
  round((distance_meters / 1000)::numeric, 3) as strava_distance_km,
  public.pfp_geometry_distance_km(geometry_geojson) as raw_geometry_distance_km,
  corrected_distance as previous_corrected_distance_km,
  public.pfp_corrected_activity_distance_km(geometry_geojson) as loop_pruned_geometry_distance_km,
  least(
    round((distance_meters / 1000)::numeric, 3),
    public.pfp_corrected_activity_distance_km(geometry_geojson)
  ) as capped_corrected_distance_km
from public.project_activities
where geometry_geojson is not null
order by started_at desc nulls last;

-- Update the existing activities after reviewing the preview above.
-- Uncomment this block when you are ready to write the corrected values.
-- update public.project_activities
-- set
--   corrected_distance = least(
--     round((distance_meters / 1000)::numeric, 3),
--     public.pfp_corrected_activity_distance_km(geometry_geojson)
--   ),
--   updated_at = now()
-- where geometry_geojson is not null;
