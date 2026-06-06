create table if not exists public.strava_oauth_states (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  return_to text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.strava_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  athlete_id bigint not null,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scope text,
  athlete jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_activities (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'strava',
  source_activity_id bigint not null,
  name text not null,
  sport_type text,
  started_at timestamptz,
  distance_meters numeric,
  moving_time_seconds integer,
  elapsed_time_seconds integer,
  total_elevation_gain_meters numeric,
  geometry_geojson jsonb,
  geometry_simplified_low jsonb,
  geometry_simplified_medium jsonb,
  geometry_simplified_high jsonb,
  raw_activity jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_activity_id)
);

alter table public.strava_oauth_states enable row level security;
alter table public.strava_connections enable row level security;
alter table public.project_activities enable row level security;

drop policy if exists "Anyone can read imported activities" on public.project_activities;
create policy "Anyone can read imported activities"
  on public.project_activities
  for select
  using (true);

drop policy if exists "Owners can insert their imported activities" on public.project_activities;
create policy "Owners can insert their imported activities"
  on public.project_activities
  for insert
  to authenticated
  with check (auth.uid() = owner_user_id);

drop policy if exists "Owners can update their imported activities" on public.project_activities;
create policy "Owners can update their imported activities"
  on public.project_activities
  for update
  to authenticated
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

drop policy if exists "Owners can delete their imported activities" on public.project_activities;
create policy "Owners can delete their imported activities"
  on public.project_activities
  for delete
  to authenticated
  using (auth.uid() = owner_user_id);
