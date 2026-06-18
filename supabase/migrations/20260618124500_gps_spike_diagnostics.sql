create or replace function public.pfp_activity_gps_spike_candidates(
  activity_geometry_geojson jsonb,
  min_spike_leg_meters double precision default 75,
  max_skip_distance_meters double precision default 30
)
returns table (
  coordinate_index integer,
  longitude double precision,
  latitude double precision,
  previous_leg_meters double precision,
  next_leg_meters double precision,
  skip_distance_meters double precision
)
language sql
stable
as $$
  with coordinates as (
    select
      (ordinality - 1)::integer as coordinate_index,
      (value->>0)::double precision as longitude,
      (value->>1)::double precision as latitude
    from jsonb_array_elements(activity_geometry_geojson->'coordinates') with ordinality
    where activity_geometry_geojson is not null
      and activity_geometry_geojson->>'type' = 'LineString'
      and jsonb_typeof(activity_geometry_geojson->'coordinates') = 'array'
  ),
  candidate_points as (
    select
      coordinate_index,
      longitude,
      latitude,
      lag(longitude) over (order by coordinate_index) as previous_longitude,
      lag(latitude) over (order by coordinate_index) as previous_latitude,
      lead(longitude) over (order by coordinate_index) as next_longitude,
      lead(latitude) over (order by coordinate_index) as next_latitude
    from coordinates
  ),
  measured_candidates as (
    select
      coordinate_index,
      longitude,
      latitude,
      public.pfp_distance_meters(
        previous_longitude,
        previous_latitude,
        longitude,
        latitude
      ) as previous_leg_meters,
      public.pfp_distance_meters(
        longitude,
        latitude,
        next_longitude,
        next_latitude
      ) as next_leg_meters,
      public.pfp_distance_meters(
        previous_longitude,
        previous_latitude,
        next_longitude,
        next_latitude
      ) as skip_distance_meters
    from candidate_points
    where previous_longitude is not null
      and previous_latitude is not null
      and next_longitude is not null
      and next_latitude is not null
  )
  select
    coordinate_index,
    longitude,
    latitude,
    previous_leg_meters,
    next_leg_meters,
    skip_distance_meters
  from measured_candidates
  where previous_leg_meters >= min_spike_leg_meters
    and next_leg_meters >= min_spike_leg_meters
    and skip_distance_meters <= max_skip_distance_meters
  order by greatest(previous_leg_meters, next_leg_meters) desc;
$$;
