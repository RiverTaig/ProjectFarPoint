alter table public.project_activities
  add column if not exists progress_story text;

create index if not exists project_activities_progress_story_present_idx
  on public.project_activities (id)
  where progress_story is not null and btrim(progress_story) <> '';
