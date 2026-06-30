insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'project-activity-images',
  'project-activity-images',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.project_activity_images (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.project_activities(id) on delete cascade,
  name text not null,
  storage_bucket text not null default 'project-activity-images',
  storage_path text not null,
  caption text,
  alt_text text,
  sort_order integer not null default 0,
  content_type text,
  size_bytes bigint,
  width_px integer,
  height_px integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_activity_images_name_not_blank check (btrim(name) <> ''),
  constraint project_activity_images_name_format check (name ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'),
  constraint project_activity_images_storage_path_not_blank check (btrim(storage_path) <> ''),
  constraint project_activity_images_unique_activity_name unique (activity_id, name),
  constraint project_activity_images_unique_storage_path unique (storage_bucket, storage_path)
);

create index if not exists project_activity_images_activity_sort_idx
  on public.project_activity_images (activity_id, sort_order, created_at);

alter table public.project_activity_images enable row level security;

create or replace function public.pfp_enforce_project_activity_image_limit()
returns trigger
language plpgsql
as $$
declare
  image_count integer;
begin
  select count(*)
  into image_count
  from public.project_activity_images pai
  where pai.activity_id = new.activity_id
    and pai.id is distinct from new.id;

  if image_count >= 10 then
    raise exception 'An activity can have at most 10 images.';
  end if;

  return new;
end;
$$;

drop trigger if exists project_activity_images_limit
  on public.project_activity_images;

create trigger project_activity_images_limit
  before insert or update of activity_id
  on public.project_activity_images
  for each row
  execute function public.pfp_enforce_project_activity_image_limit();

create or replace function public.pfp_user_owns_project_activity(project_activity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.project_activities pa
    where pa.id = project_activity_id
      and pa.owner_user_id = auth.uid()
  );
$$;

drop policy if exists "Anyone can read activity images" on public.project_activity_images;
create policy "Anyone can read activity images"
  on public.project_activity_images
  for select
  using (true);

drop policy if exists "Owners can insert activity images" on public.project_activity_images;
create policy "Owners can insert activity images"
  on public.project_activity_images
  for insert
  to authenticated
  with check (public.pfp_user_owns_project_activity(activity_id));

drop policy if exists "Owners can update activity images" on public.project_activity_images;
create policy "Owners can update activity images"
  on public.project_activity_images
  for update
  to authenticated
  using (public.pfp_user_owns_project_activity(activity_id))
  with check (public.pfp_user_owns_project_activity(activity_id));

drop policy if exists "Owners can delete activity images" on public.project_activity_images;
create policy "Owners can delete activity images"
  on public.project_activity_images
  for delete
  to authenticated
  using (public.pfp_user_owns_project_activity(activity_id));

create or replace function public.pfp_storage_activity_id(object_name text)
returns uuid
language plpgsql
stable
as $$
declare
  first_folder text;
begin
  first_folder := (storage.foldername(object_name))[1];

  if first_folder is null then
    return null;
  end if;

  return first_folder::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

create or replace function public.pfp_user_owns_project_activity_storage_object(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public, storage
as $$
  select public.pfp_user_owns_project_activity(
    public.pfp_storage_activity_id(object_name)
  );
$$;

drop policy if exists "Anyone can read project activity image files" on storage.objects;
create policy "Anyone can read project activity image files"
  on storage.objects
  for select
  using (bucket_id = 'project-activity-images');

drop policy if exists "Owners can upload project activity image files" on storage.objects;
create policy "Owners can upload project activity image files"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'project-activity-images'
    and public.pfp_user_owns_project_activity_storage_object(name)
  );

drop policy if exists "Owners can update project activity image files" on storage.objects;
create policy "Owners can update project activity image files"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'project-activity-images'
    and public.pfp_user_owns_project_activity_storage_object(name)
  )
  with check (
    bucket_id = 'project-activity-images'
    and public.pfp_user_owns_project_activity_storage_object(name)
  );

drop policy if exists "Owners can delete project activity image files" on storage.objects;
create policy "Owners can delete project activity image files"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'project-activity-images'
    and public.pfp_user_owns_project_activity_storage_object(name)
  );
