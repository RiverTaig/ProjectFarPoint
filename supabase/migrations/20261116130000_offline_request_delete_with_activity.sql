-- Retain duplicate protection while a hike exists, but remove its processing
-- record when that completed activity is deliberately deleted.
-- Run once in SQL Editor. Does not delete any existing rows by itself.
begin;
alter table public.offline_activity_requests
  drop constraint offline_activity_requests_result_activity_id_fkey;
alter table public.offline_activity_requests
  add constraint offline_activity_requests_result_activity_id_fkey
  foreign key (result_activity_id) references public.project_activities(id)
  on delete cascade;
commit;
