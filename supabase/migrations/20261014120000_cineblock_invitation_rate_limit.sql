create table if not exists public.cineblock_invitation_events (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.cineblock_projects(id) on delete cascade,
  inviter_id uuid not null references auth.users(id) on delete cascade,
  invitee_email text not null,
  created_at timestamptz not null default now()
);

create index if not exists cineblock_invitation_events_inviter_created_idx
  on public.cineblock_invitation_events (inviter_id, created_at desc);

alter table public.cineblock_invitation_events enable row level security;
revoke all on public.cineblock_invitation_events from anon, authenticated;
grant all on public.cineblock_invitation_events to service_role;