alter table public.project_activities
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists province text,
  add column if not exists country text,
  add column if not exists corrected_distance numeric,
  add column if not exists distance_made_good numeric,
  add column if not exists trail_name text,
  add column if not exists pfp_type text;

alter table public.project_activities
  drop constraint if exists project_activities_pfp_type_check;

alter table public.project_activities
  add constraint project_activities_pfp_type_check
  check (pfp_type is null or pfp_type in ('Voyager', 'Far Point Trail'));

create index if not exists project_activities_city_idx
  on public.project_activities (city);

create index if not exists project_activities_state_idx
  on public.project_activities (state);

create index if not exists project_activities_province_idx
  on public.project_activities (province);

create index if not exists project_activities_country_idx
  on public.project_activities (country);

create index if not exists project_activities_pfp_type_idx
  on public.project_activities (pfp_type);

create index if not exists project_activities_trail_name_idx
  on public.project_activities (trail_name);
