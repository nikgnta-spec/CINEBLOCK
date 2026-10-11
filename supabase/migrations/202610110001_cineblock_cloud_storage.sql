-- CineBlock cloud storage foundation.
-- Additive migration: intentionally leaves the legacy public.projects table and its data untouched.
-- Apply this file in the Supabase SQL Editor for the CineBlock project.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.cineblock_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Proyek tanpa judul' check (char_length(name) between 1 and 200),
  payload jsonb not null default '{}'::jsonb,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cineblock_project_members (
  project_id uuid not null references public.cineblock_projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role in ('editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists cineblock_projects_owner_updated_idx
  on public.cineblock_projects (owner_id, updated_at desc);
create index if not exists cineblock_project_members_user_idx
  on public.cineblock_project_members (user_id, project_id);

create or replace function public.cineblock_touch_project()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.revision := old.revision + 1;
  return new;
end;
$$;

drop trigger if exists cineblock_projects_touch on public.cineblock_projects;
create trigger cineblock_projects_touch
before update on public.cineblock_projects
for each row execute function public.cineblock_touch_project();

alter table public.cineblock_projects enable row level security;
alter table public.cineblock_project_members enable row level security;

-- Owners can read and modify their own projects.
drop policy if exists "CineBlock owners can read projects" on public.cineblock_projects;
create policy "CineBlock owners can read projects"
on public.cineblock_projects for select to authenticated
using (owner_id = (select auth.uid()));

drop policy if exists "CineBlock owners can create projects" on public.cineblock_projects;
create policy "CineBlock owners can create projects"
on public.cineblock_projects for insert to authenticated
with check (owner_id = (select auth.uid()));

drop policy if exists "CineBlock owners can update projects" on public.cineblock_projects;
create policy "CineBlock owners can update projects"
on public.cineblock_projects for update to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

drop policy if exists "CineBlock owners can delete projects" on public.cineblock_projects;
create policy "CineBlock owners can delete projects"
on public.cineblock_projects for delete to authenticated
using (owner_id = (select auth.uid()));

-- Membership rows are readable by their user and the project owner.
drop policy if exists "CineBlock members can read memberships" on public.cineblock_project_members;
create policy "CineBlock members can read memberships"
on public.cineblock_project_members for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.cineblock_projects p
    where p.id = project_id and p.owner_id = (select auth.uid())
  )
);

-- Only an owner may invite/manage memberships. This also prevents users from
-- granting themselves access to arbitrary project IDs.
drop policy if exists "CineBlock owners can add memberships" on public.cineblock_project_members;
create policy "CineBlock owners can add memberships"
on public.cineblock_project_members for insert to authenticated
with check (
  exists (
    select 1 from public.cineblock_projects p
    where p.id = project_id and p.owner_id = (select auth.uid())
  )
);

drop policy if exists "CineBlock owners can remove memberships" on public.cineblock_project_members;
create policy "CineBlock owners can remove memberships"
on public.cineblock_project_members for delete to authenticated
using (
  exists (
    select 1 from public.cineblock_projects p
    where p.id = project_id and p.owner_id = (select auth.uid())
  )
);

-- Members may read shared project payloads. Editing is owner-only in this first
-- migration; editor writes are enabled only after conflict-safe save APIs land.
drop policy if exists "CineBlock members can read shared projects" on public.cineblock_projects;
create policy "CineBlock members can read shared projects"
on public.cineblock_projects for select to authenticated
using (
  exists (
    select 1 from public.cineblock_project_members m
    where m.project_id = id and m.user_id = (select auth.uid())
  )
);

-- Keep these tables available to Supabase Realtime if the publication exists.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'cineblock_projects'
    ) then
      alter publication supabase_realtime add table public.cineblock_projects;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'cineblock_project_members'
    ) then
      alter publication supabase_realtime add table public.cineblock_project_members;
    end if;
  end if;
end;
$$;
