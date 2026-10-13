-- Repair references after moving role helpers into the private schema.
create or replace function private.cineblock_scene_role(p_scene_id uuid)
returns text language sql stable security definer set search_path = '' as $$
 select private.cineblock_project_role(s.project_id)
 from public.cineblock_scenes s where s.id=p_scene_id;
$$;
create or replace function private.cineblock_shot_role(p_shot_id uuid)
returns text language sql stable security definer set search_path = '' as $$
 select private.cineblock_scene_role(s.scene_id)
 from public.cineblock_shots s where s.id=p_shot_id;
$$;
revoke all on function private.cineblock_scene_role(uuid) from public, anon;
revoke all on function private.cineblock_shot_role(uuid) from public, anon;
grant execute on function private.cineblock_scene_role(uuid) to authenticated;
grant execute on function private.cineblock_shot_role(uuid) to authenticated;
