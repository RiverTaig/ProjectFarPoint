-- Run once before the numbered data parts.
begin;
create table if not exists public.pfp_trail_import_chunks (
  import_id text not null,
  part integer not null check (part > 0),
  payload text not null,
  primary key (import_id, part)
);
alter table public.pfp_trail_import_chunks enable row level security;
revoke all on public.pfp_trail_import_chunks from public, anon, authenticated;
commit;
