alter table public.project_activities
  add column if not exists continent text;

create index if not exists project_activities_continent_idx
  on public.project_activities (continent);
