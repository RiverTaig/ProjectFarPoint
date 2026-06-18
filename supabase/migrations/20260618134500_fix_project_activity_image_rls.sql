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
