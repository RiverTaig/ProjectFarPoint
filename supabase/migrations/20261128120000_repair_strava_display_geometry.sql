-- Repair display geometry from the full GPS track already stored in each row.
-- Leaves activity IDs, full tracks, text, images, and distance credit intact.
-- Future imports use the matching tolerances in _shared/simplifyCoordinates.ts.
begin;
set local search_path = public, extensions, pg_catalog;

with tracks as (
  select id, st_setsrid(st_geomfromgeojson(geometry_geojson::text), 4326) as line
  from public.project_activities
  where source in ('strava', 'strava_route')
    and geometry_geojson->>'type' = 'LineString'
    and jsonb_array_length(geometry_geojson->'coordinates') >= 2
)
update public.project_activities as activity
set geometry_simplified_low = st_asgeojson(st_simplify(tracks.line, 0.0002), 9)::jsonb,
    geometry_simplified_medium = st_asgeojson(st_simplify(tracks.line, 0.00002), 9)::jsonb,
    geometry_simplified_high = st_asgeojson(st_simplify(tracks.line, 0.000005), 9)::jsonb
from tracks
where activity.id = tracks.id;

commit;

-- The Going/Alberta Loop should now have substantially more than three display points.
select name, trail_name,
       jsonb_array_length(geometry_geojson->'coordinates') as full_points,
       jsonb_array_length(geometry_simplified_medium->'coordinates') as display_points
from public.project_activities
where source in ('strava', 'strava_route');
