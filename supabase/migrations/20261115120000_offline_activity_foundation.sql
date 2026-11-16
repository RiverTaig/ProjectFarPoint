-- Step 3 foundation only. Does not enable submission or replacement yet.
-- Run once in Supabase SQL Editor after existing project migrations.
begin;

create table public.trails (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z][A-Z0-9]{0,15}$'),
  name text not null check (length(trim(name)) > 0),
  timezone text not null,
  snap_tolerance_meters numeric not null default 100
    check (snap_tolerance_meters > 0 and snap_tolerance_meters <= 100),
  current_version_id uuid,
  created_at timestamptz not null default now()
);

create function public.pfp_validate_trail_timezone()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown trail timezone: %', new.timezone;
  end if;
  return new;
end;
$$;
create trigger trails_validate_timezone before insert or update on public.trails
for each row execute function public.pfp_validate_trail_timezone();

create table public.trail_versions (
  id uuid primary key default gen_random_uuid(),
  trail_id uuid not null references public.trails(id),
  version text not null check (length(trim(version)) > 0),
  geojson jsonb not null check (
    coalesce(geojson->>'type' = 'Feature'
      and geojson->'geometry'->>'type' in ('LineString', 'MultiLineString')
      and jsonb_typeof(geojson->'geometry'->'coordinates') = 'array', false)
  ),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  source_filename text not null,
  attribution text not null,
  license text not null,
  created_at timestamptz not null default now(),
  unique (trail_id, version),
  unique (trail_id, id)
);
alter table public.trails add constraint trails_current_version_fk
foreign key (id, current_version_id) references public.trail_versions(trail_id, id);

create function public.pfp_preserve_trail_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Trail versions are immutable; publish a new version instead.';
end;
$$;
create trigger trail_versions_immutable before update or delete on public.trail_versions
for each row execute function public.pfp_preserve_trail_version();

-- Explicit authorization for Ken to submit on the activity owner's behalf.
-- Populate via SQL Editor only; browser users cannot grant themselves access.
create table public.offline_activity_submitters (
  submitter_user_id uuid not null references auth.users(id),
  owner_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (submitter_user_id, owner_user_id)
);

create table public.offline_activity_requests (
  id uuid primary key default gen_random_uuid(),
  -- Use this value as project_activities.source_activity_id for source offline.
  source_activity_id bigint generated always as identity unique,
  owner_user_id uuid not null references auth.users(id),
  submitted_by uuid not null references auth.users(id),
  trail_id uuid not null references public.trails(id),
  trail_version_id uuid not null,
  applies_to text not null check (applies_to in ('Voyager', 'Far Point Trail')),
  local_datetime text not null check (local_datetime ~ '^[0-9]{8}T[0-9]{4}$'),
  trail_timezone text not null,
  started_at timestamptz not null,
  start_longitude numeric not null check (start_longitude between -180 and 180),
  start_latitude numeric not null check (start_latitude between -90 and 90),
  end_longitude numeric not null check (end_longitude between -180 and 180),
  end_latitude numeric not null check (end_latitude between -90 and 90),
  original_parameters jsonb not null check (jsonb_typeof(original_parameters) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  processing_started_at timestamptz,
  completed_at timestamptz,
  error_details jsonb,
  result_activity_id uuid references public.project_activities(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (trail_id, trail_version_id)
    references public.trail_versions(trail_id, id),
  constraint offline_request_completed_result check (
    (status = 'completed' and result_activity_id is not null and completed_at is not null)
    or (status <> 'completed' and result_activity_id is null and completed_at is null)
  ),
  -- Deliberately excludes trail version: replaying a link after a trail update
  -- still returns the original result. Corrections edit/reconcile that request.
  unique (owner_user_id, trail_id, applies_to, local_datetime,
    start_longitude, start_latitude, end_longitude, end_latitude)
);
create index offline_requests_work_idx on public.offline_activity_requests(status, created_at)
where status in ('pending', 'processing', 'failed');

alter table public.project_activities
  add column offline_request_id uuid unique references public.offline_activity_requests(id),
  add column trail_version_id uuid references public.trail_versions(id),
  add column superseded_by_activity_id uuid references public.project_activities(id),
  add column superseded_at timestamptz,
  add constraint project_activity_offline_origin check (
    (source = 'offline' and offline_request_id is not null and trail_version_id is not null)
    or (source <> 'offline' and offline_request_id is null)
  ),
  add constraint project_activity_superseded_pair check (
    (superseded_by_activity_id is null) = (superseded_at is null)
  ),
  add constraint project_activity_not_self_replaced check (
    superseded_by_activity_id is distinct from id
  );
-- Do not populate superseded fields until step 8 updates every reader and
-- overlap/progress calculation. Existing behavior is unchanged by null fields.

create function public.pfp_validate_offline_activity_origin()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.source = 'offline' and not exists (
    select 1 from public.offline_activity_requests r
    where r.id = new.offline_request_id
      and r.source_activity_id = new.source_activity_id
      and r.owner_user_id = new.owner_user_id
      and r.trail_version_id = new.trail_version_id
      and r.applies_to = new.pfp_type
      and r.started_at = new.started_at
  ) then
    raise exception 'Offline activity must match its originating request.';
  end if;
  return new;
end;
$$;
create trigger project_activities_validate_offline_origin
before insert or update on public.project_activities
for each row execute function public.pfp_validate_offline_activity_origin();

alter table public.trails enable row level security;
alter table public.trail_versions enable row level security;
alter table public.offline_activity_submitters enable row level security;
alter table public.offline_activity_requests enable row level security;

revoke all on public.trails, public.trail_versions,
  public.offline_activity_submitters, public.offline_activity_requests from anon, authenticated;
revoke all on sequence public.offline_activity_requests_source_activity_id_seq from anon, authenticated;
grant select on public.trails, public.trail_versions to anon, authenticated;
grant select on public.offline_activity_requests, public.offline_activity_submitters to authenticated;
create policy "Public trail metadata" on public.trails for select to anon, authenticated using (true);
create policy "Public trail geometry" on public.trail_versions for select to anon, authenticated using (true);
create policy "Read own offline requests" on public.offline_activity_requests
for select to authenticated using (auth.uid() = owner_user_id or auth.uid() = submitted_by);
create policy "Read own submission permission" on public.offline_activity_submitters
for select to authenticated using (auth.uid() = submitter_user_id or auth.uid() = owner_user_id);
grant all on public.trails, public.trail_versions,
  public.offline_activity_submitters, public.offline_activity_requests to service_role;
grant usage, select on sequence public.offline_activity_requests_source_activity_id_seq to service_role;
-- Step 5 must verify the caller and consult offline_activity_submitters before
-- using server credentials. No client INSERT/UPDATE/DELETE policies are granted.

commit;
