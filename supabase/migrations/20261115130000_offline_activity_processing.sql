-- Step 5. Run after the foundation migration and trail import.
-- No password is stored here. No activities are created by this migration.
begin;

alter table public.offline_activity_requests
  alter column submitted_by drop not null,
  add column authentication_method text not null default 'supabase_auth'
    check (authentication_method in ('supabase_auth', 'shared_password')),
  add column processing_token uuid,
  add constraint offline_request_submitter_auth check (
    (authentication_method = 'shared_password' and submitted_by is null)
    or (authentication_method = 'supabase_auth' and submitted_by is not null)
  );
comment on column public.offline_activity_requests.submitted_by is
  'NULL for shared-password submission: no signed-in identity is asserted.';

create function public.pfp_offline_request_result(p_request uuid, p_status text)
returns jsonb language sql stable set search_path = public, extensions as $$
  select jsonb_build_object(
    'status', p_status, 'requestId', r.id, 'activityId', a.id,
    'trail', t.code, 'trailName', t.name, 'trailVersion', v.version,
    'appliesTo', r.applies_to, 'dateTime', r.started_at,
    'localDateTime', r.local_datetime, 'timezone', r.trail_timezone,
    'start', jsonb_build_array(r.start_longitude, r.start_latitude),
    'end', jsonb_build_array(r.end_longitude, r.end_latitude),
    'snappedStart', a.geometry_geojson->'coordinates'->0,
    'snappedEnd', a.geometry_geojson->'coordinates'->-1,
    'distanceMeters', a.distance_meters, 'distanceKilometers', a.corrected_distance,
    'creditedKilometers', a.distance_made_good,
    'startSnapMeters', st_distance(st_startpoint(a.activity_geometry)::geography,
      st_setsrid(st_makepoint(r.start_longitude::float8, r.start_latitude::float8),4326)::geography, false),
    'endSnapMeters', st_distance(st_endpoint(a.activity_geometry)::geography,
      st_setsrid(st_makepoint(r.end_longitude::float8, r.end_latitude::float8),4326)::geography, false)
  ) from public.offline_activity_requests r
  join public.project_activities a on a.id = r.result_activity_id
  join public.trails t on t.id = r.trail_id
  join public.trail_versions v on v.id = r.trail_version_id
  where r.id = p_request and r.status = 'completed';
$$;

create function public.pfp_prepare_offline_request(
  p_owner uuid, p_trail uuid, p_path text, p_local text, p_started timestamptz,
  p_start_lon numeric, p_start_lat numeric, p_end_lon numeric, p_end_lat numeric
)
returns jsonb language plpgsql set search_path = public, extensions as $$
declare
  t public.trails%rowtype;
  r public.offline_activity_requests%rowtype;
begin
  if p_owner is null or p_started is null or p_local is null
    or p_local !~ '^[0-9]{8}T[0-9]{4}$'
    or p_path is null or p_path not in ('Voyager', 'Far Point Trail')
    or p_start_lon is null or p_start_lat is null or p_end_lon is null or p_end_lat is null
    or p_start_lon not between -180 and 180 or p_end_lon not between -180 and 180
    or p_start_lat not between -90 and 90 or p_end_lat not between -90 and 90 then
    raise exception 'Invalid offline request parameters.';
  end if;
  -- Serializes creation/retry claims for the same owner; each RPC is one txn.
  perform pg_advisory_xact_lock(hashtextextended('pfp-offline-owner:' || p_owner::text, 0));
  select * into t from public.trails where id = p_trail for share;
  if not found or t.current_version_id is null then raise exception 'Trail has no published geometry.'; end if;

  select * into r from public.offline_activity_requests
  where owner_user_id = p_owner and trail_id = p_trail and applies_to = p_path
    and local_datetime = p_local and start_longitude = p_start_lon and start_latitude = p_start_lat
    and end_longitude = p_end_lon and end_latitude = p_end_lat
  for update;
  if not found then
    if to_char(p_started at time zone t.timezone, 'YYYYMMDD"T"HH24MI') <> p_local then
      raise exception 'Resolved time does not match the trail local date/time.';
    end if;
    insert into public.offline_activity_requests (
      owner_user_id, submitted_by, authentication_method, trail_id, trail_version_id,
      applies_to, local_datetime, trail_timezone, started_at,
      start_longitude, start_latitude, end_longitude, end_latitude, original_parameters
    ) values (
      p_owner, null, 'shared_password', t.id, t.current_version_id,
      p_path, p_local, t.timezone, p_started,
      p_start_lon, p_start_lat, p_end_lon, p_end_lat,
      jsonb_build_object('t',t.code,'p',case when p_path = 'Voyager' then 'V' else 'F' end,
        'dt',p_local,'s',p_start_lon::text || ',' || p_start_lat::text,
        'e',p_end_lon::text || ',' || p_end_lat::text)
    ) returning * into r;
  end if;
  if r.status = 'completed' then
    return jsonb_build_object('state','completed','result',public.pfp_offline_request_result(r.id,'already_processed'));
  end if;
  if r.status = 'processing' and r.processing_started_at > now() - interval '5 minutes' then
    return jsonb_build_object('state','processing','requestId',r.id);
  end if;
  update public.offline_activity_requests set status = 'processing',
    processing_token = gen_random_uuid(), processing_started_at = now(),
    attempt_count = attempt_count + 1, updated_at = now(), error_details = null
  where id = r.id returning * into r;
  return jsonb_build_object('state','claimed','request',to_jsonb(r));
end;
$$;

-- Far Point Trail's repeated segments receive no credit, with no seasonal
-- reset. This uses the same 15 m buffer technique as Voyager, scoped to the
-- owner's earlier Far Point Trail activities. It does not change Strava import.
create function public.pfp_offline_far_point_credit_km(
  p_owner uuid, p_geometry jsonb, p_started timestamptz, p_source text, p_source_id bigint,
  p_distance double precision
)
returns numeric language plpgsql stable set search_path = public, extensions as $$
declare
  line geometry;
  covered geometry;
  meters double precision;
  uncovered double precision;
begin
  line := public.pfp_activity_geometry_from_geojson(p_geometry);
  if line is null then return null; end if;
  meters := st_length(line::geography);
  if meters <= 0 then return 0; end if;
  select st_unaryunion(st_collect(st_buffer(a.activity_geometry::geography,15)::geometry))
  into covered from public.project_activities a
  where a.owner_user_id = p_owner and a.pfp_type = 'Far Point Trail'
    and a.activity_geometry is not null and a.superseded_by_activity_id is null
    and a.started_at < p_started
    and not (a.source = p_source and a.source_activity_id = p_source_id)
    and st_dwithin(a.activity_geometry::geography,line::geography,15);
  if covered is null then return round((p_distance/1000)::numeric,3); end if;
  uncovered := st_length(st_difference(line,covered)::geography);
  return round((p_distance * least(1, uncovered/meters)/1000)::numeric,3);
end;
$$;

create function public.pfp_complete_offline_request(p_request uuid, p_token uuid, p_geometry jsonb)
returns jsonb language plpgsql set search_path = public, extensions as $$
declare
  r public.offline_activity_requests%rowtype;
  t public.trails%rowtype;
  line geometry;
  meters double precision;
  activity_id uuid;
  later record;
  credit numeric;
begin
  -- All offline completions serialize progress calculation as well as inserts.
  perform pg_advisory_xact_lock(hashtextextended('pfp-offline-progress',0));
  select * into r from public.offline_activity_requests where id = p_request for update;
  if not found then raise exception 'Offline request not found.'; end if;
  if r.status = 'completed' then return public.pfp_offline_request_result(r.id,'already_processed'); end if;
  if r.status <> 'processing' or r.processing_token is distinct from p_token or p_token is null then
    raise exception 'Offline request processing claim has expired or changed.';
  end if;
  select * into t from public.trails where id = r.trail_id;
  line := public.pfp_activity_geometry_from_geojson(p_geometry);
  if line is null or st_isempty(line) or not st_isvalid(line) or st_npoints(line) < 2 then
    raise exception 'Invalid extracted trail geometry.';
  end if;
  if st_xmin(box3d(line)) < -180 or st_xmax(box3d(line)) > 180
    or st_ymin(box3d(line)) < -90 or st_ymax(box3d(line)) > 90 then
    raise exception 'Extracted geometry exceeds WGS84 coordinate bounds.';
  end if;
  -- Spherical snap distances match the shared extractor; hiking length below
  -- uses PostGIS spheroidal geography for authoritative stored distance.
  if st_distance(st_startpoint(line)::geography,
      st_setsrid(st_makepoint(r.start_longitude::float8,r.start_latitude::float8),4326)::geography,false) > t.snap_tolerance_meters
    or st_distance(st_endpoint(line)::geography,
      st_setsrid(st_makepoint(r.end_longitude::float8,r.end_latitude::float8),4326)::geography,false) > t.snap_tolerance_meters then
    raise exception 'Extracted endpoints exceed the trail snapping tolerance.';
  end if;
  meters := st_length(line::geography);
  if not (meters > 0 and meters < 'Infinity'::float8) then raise exception 'Invalid trail distance.'; end if;

  insert into public.project_activities (
    owner_user_id, source, source_activity_id, offline_request_id, trail_version_id,
    name, sport_type, started_at, distance_meters, corrected_distance,
    trail_name, pfp_type, text_description, geometry_geojson,
    geometry_simplified_low, geometry_simplified_medium, geometry_simplified_high
  ) values (
    r.owner_user_id,'offline',r.source_activity_id,r.id,r.trail_version_id,
    t.name || ' - ' || to_char(r.started_at at time zone r.trail_timezone,'YYYY-MM-DD') || ' (offline)',
    'Hike',r.started_at,meters,round((meters/1000)::numeric,3),t.name,r.applies_to,
    'Reported by satellite message; path reconstructed from registered trail geometry.',
    p_geometry,p_geometry,p_geometry,p_geometry
  ) returning id into activity_id;

  -- Recompute the inserted hike and affected later credits so late reports
  -- don't count the same geometry twice. Preserve Voyager's existing function
  -- and seasonal definition exactly. Equal-time behavior remains unchanged.
  for later in select a.* from public.project_activities a
    where a.pfp_type = r.applies_to and a.started_at >= r.started_at
      and a.superseded_by_activity_id is null
      and a.activity_geometry is not null
      and ((r.applies_to = 'Voyager' and public.pfp_activity_season(a.started_at) = public.pfp_activity_season(r.started_at))
        or (r.applies_to = 'Far Point Trail' and a.owner_user_id = r.owner_user_id))
    order by a.started_at,a.id
  loop
    if r.applies_to = 'Voyager' then
      credit := public.pfp_distance_made_good_km(later.geometry_geojson,later.started_at,
        later.source,later.source_activity_id,15,later.distance_meters::float8);
    else
      credit := public.pfp_offline_far_point_credit_km(later.owner_user_id,later.geometry_geojson,
        later.started_at,later.source,later.source_activity_id,later.distance_meters::float8);
    end if;
    update public.project_activities set distance_made_good = credit, updated_at = now() where id = later.id;
  end loop;
  update public.offline_activity_requests set status = 'completed', result_activity_id = activity_id,
    completed_at = now(), updated_at = now(), processing_token = null, error_details = null
  where id = r.id;
  return public.pfp_offline_request_result(r.id,'completed');
end;
$$;

create function public.pfp_fail_offline_request(p_request uuid,p_token uuid,p_code text,p_message text)
returns void language sql set search_path = public, extensions as $$
  update public.offline_activity_requests set status = 'failed', updated_at = now(),
    processing_token = null,
    error_details = jsonb_build_object('code',left(p_code,100),'message',left(p_message,1000))
  where id = p_request and status = 'processing' and processing_token = p_token;
$$;

-- Only the password-validating server handler can call these functions.
revoke all on function public.pfp_offline_request_result(uuid,text) from public,anon,authenticated;
revoke all on function public.pfp_prepare_offline_request(uuid,uuid,text,text,timestamptz,numeric,numeric,numeric,numeric) from public,anon,authenticated;
revoke all on function public.pfp_complete_offline_request(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.pfp_fail_offline_request(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.pfp_offline_far_point_credit_km(uuid,jsonb,timestamptz,text,bigint,double precision) from public,anon,authenticated;
grant execute on function public.pfp_offline_request_result(uuid,text) to service_role;
grant execute on function public.pfp_prepare_offline_request(uuid,uuid,text,text,timestamptz,numeric,numeric,numeric,numeric) to service_role;
grant execute on function public.pfp_complete_offline_request(uuid,uuid,jsonb) to service_role;
grant execute on function public.pfp_fail_offline_request(uuid,uuid,text,text) to service_role;
grant execute on function public.pfp_offline_far_point_credit_km(uuid,jsonb,timestamptz,text,bigint,double precision) to service_role;

commit;
