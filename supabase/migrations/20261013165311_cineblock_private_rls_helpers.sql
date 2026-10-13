-- Keep SECURITY DEFINER RLS helpers outside PostgREST's exposed public schema.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;
alter function public.cineblock_project_role(uuid) set schema private;
alter function public.cineblock_scene_role(uuid) set schema private;
alter function public.cineblock_shot_role(uuid) set schema private;
revoke all on function private.cineblock_project_role(uuid) from public, anon;
revoke all on function private.cineblock_scene_role(uuid) from public, anon;
revoke all on function private.cineblock_shot_role(uuid) from public, anon;
grant execute on function private.cineblock_project_role(uuid) to authenticated;
grant execute on function private.cineblock_scene_role(uuid) to authenticated;
grant execute on function private.cineblock_shot_role(uuid) to authenticated;

-- Function bodies must use the new private schema after moving helpers out of public.
create or replace function private.cineblock_scene_role(p_scene_id uuid)
returns text language sql stable security definer set search_path = '' as $$
 select private.cineblock_project_role(s.project_id) from public.cineblock_scenes s where s.id=p_scene_id;
$$;
create or replace function private.cineblock_shot_role(p_shot_id uuid)
returns text language sql stable security definer set search_path = '' as $$
 select private.cineblock_scene_role(s.scene_id) from public.cineblock_shots s where s.id=p_shot_id;
$$;
revoke all on function private.cineblock_scene_role(uuid) from public, anon;
revoke all on function private.cineblock_shot_role(uuid) from public, anon;
grant execute on function private.cineblock_scene_role(uuid) to authenticated;
grant execute on function private.cineblock_shot_role(uuid) to authenticated;
