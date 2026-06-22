alter table public.project_activities
  add column if not exists strava_url text,
  add column if not exists strava_type text;

alter table public.project_activities
  drop constraint if exists project_activities_strava_type_check;

alter table public.project_activities
  add constraint project_activities_strava_type_check
  check (strava_type is null or strava_type in ('Activity', 'Route'));

update public.project_activities
set
  strava_type = 'Activity',
  strava_url = 'https://www.strava.com/activities/' || source_activity_id::text
where source = 'strava'
  and source_activity_id is not null
  and (strava_type is null or strava_url is null);

update public.project_activities
set
  strava_type = 'Route',
  strava_url = 'https://www.strava.com/routes/' || source_activity_id::text
where source = 'strava_route'
  and source_activity_id is not null
  and (strava_type is null or strava_url is null);
