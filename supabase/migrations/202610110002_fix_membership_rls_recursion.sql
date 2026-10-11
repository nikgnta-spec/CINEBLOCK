-- Fix RLS policy recursion in CineBlock project membership checks.
-- Safe additive follow-up for projects where 202610110001 has already been applied.

create or replace function public.cineblock_is_project_owner(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.cineblock_projects p
    where p.id = target_project_id
      and p.owner_id = (select auth.uid())
  );
$$;

-- This helper reveals only whether the current user owns the specified project.
-- Restrict execution to authenticated sessions; policy evaluation runs as the user.
revoke all on function public.cineblock_is_project_owner(uuid) from public;
grant execute on function public.cineblock_is_project_owner(uuid) to authenticated;

drop policy if exists "CineBlock members can read memberships" on public.cineblock_project_members;
create policy "CineBlock members can read memberships"
on public.cineblock_project_members for select to authenticated
using (
  user_id = (select auth.uid())
  or public.cineblock_is_project_owner(project_id)
);

drop policy if exists "CineBlock owners can add memberships" on public.cineblock_project_members;
create policy "CineBlock owners can add memberships"
on public.cineblock_project_members for insert to authenticated
with check (public.cineblock_is_project_owner(project_id));

drop policy if exists "CineBlock owners can remove memberships" on public.cineblock_project_members;
create policy "CineBlock owners can remove memberships"
on public.cineblock_project_members for delete to authenticated
using (public.cineblock_is_project_owner(project_id));
