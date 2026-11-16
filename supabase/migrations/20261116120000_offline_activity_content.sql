-- Add descriptions/photos to completed offline hikes through the server only.
-- Requires the existing project_activity_images migration. No new public writes.
begin;
create function public.pfp_save_offline_content(
  p_request uuid, p_owner uuid, p_description text default null, p_image jsonb default null
)
returns uuid language plpgsql set search_path = public as $$
declare
  activity uuid;
  existing public.project_activity_images%rowtype;
  image_name text;
  image_path text;
begin
  select a.id into activity from public.offline_activity_requests r
  join public.project_activities a on a.id = r.result_activity_id and a.offline_request_id = r.id
  where r.id = p_request and r.status = 'completed' and r.owner_user_id = p_owner
    and a.owner_user_id = p_owner and a.source = 'offline' and a.superseded_by_activity_id is null;
  if activity is null then raise exception 'OFFLINE_ACTIVITY_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pfp-offline-content:' || activity::text,0));
  if p_description is not null then
    if char_length(p_description) > 20000 then raise exception 'DESCRIPTION_TOO_LONG'; end if;
    update public.project_activities set text_description = p_description, updated_at = now() where id = activity;
  end if;
  if p_image is not null then
    image_name := p_image->>'name'; image_path := p_image->>'storage_path';
    if image_name is null or image_name !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'
      or image_path is null or image_path !~ ('^' || activity::text || '/offline/[a-z0-9_-]+-[0-9a-f]{64}\.(jpg|png|webp|gif)$')
      or coalesce(p_image->>'content_type','') not in ('image/jpeg','image/png','image/webp','image/gif')
      or coalesce((p_image->>'size_bytes')::bigint,0) not between 1 and 10485760
      or char_length(coalesce(p_image->>'caption','')) > 1000
      or coalesce((p_image->>'sort_order')::integer,0) not between 0 and 10000 then
      raise exception 'INVALID_IMAGE_METADATA';
    end if;
    select * into existing from public.project_activity_images where activity_id = activity
      and lower(name) = lower(image_name) limit 1;
    if found then
      if existing.storage_path <> image_path then raise exception 'IMAGE_NAME_IN_USE'; end if;
      update public.project_activity_images set caption = nullif(p_image->>'caption',''),
        alt_text = coalesce(nullif(p_image->>'caption',''),existing.name), updated_at = now()
      where id = existing.id;
    else
      if (select count(*) from public.project_activity_images where activity_id = activity) >= 10 then
        raise exception 'IMAGE_LIMIT_REACHED';
      end if;
      insert into public.project_activity_images (
        activity_id,name,storage_bucket,storage_path,caption,alt_text,sort_order,content_type,size_bytes
      ) values (activity,image_name,'project-activity-images',image_path,nullif(p_image->>'caption',''),
        coalesce(nullif(p_image->>'caption',''),image_name),coalesce((p_image->>'sort_order')::integer,0),
        p_image->>'content_type',(p_image->>'size_bytes')::bigint);
    end if;
  end if;
  return activity;
end;
$$;
revoke all on function public.pfp_save_offline_content(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.pfp_save_offline_content(uuid,uuid,text,jsonb) to service_role;
commit;
