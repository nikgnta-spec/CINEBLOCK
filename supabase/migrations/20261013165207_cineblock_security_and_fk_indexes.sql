-- Security and index hardening for CineBlock relational tables.
revoke all on function public.cineblock_add_project_owner_membership() from public, anon, authenticated;
revoke all on function public.cineblock_project_role(uuid) from public, anon;
revoke all on function public.cineblock_scene_role(uuid) from public, anon;
revoke all on function public.cineblock_shot_role(uuid) from public, anon;
grant execute on function public.cineblock_project_role(uuid) to authenticated;
grant execute on function public.cineblock_scene_role(uuid) to authenticated;
grant execute on function public.cineblock_shot_role(uuid) to authenticated;
create index if not exists cineblock_scenes_updated_by_idx on public.cineblock_scenes(updated_by);
create index if not exists cineblock_shots_updated_by_idx on public.cineblock_shots(updated_by);
create index if not exists cineblock_floorplan_shot_scene_idx on public.cineblock_floorplan_elements(shot_id,scene_id);
create index if not exists cineblock_floorplan_updated_by_idx on public.cineblock_floorplan_elements(updated_by);
create index if not exists cineblock_cameras_shot_scene_idx on public.cineblock_cameras(shot_id,scene_id);
create index if not exists cineblock_cameras_updated_by_idx on public.cineblock_cameras(updated_by);
create index if not exists cineblock_actors_shot_scene_idx on public.cineblock_actors(shot_id,scene_id);
create index if not exists cineblock_actors_updated_by_idx on public.cineblock_actors(updated_by);
create index if not exists cineblock_lighting_shot_scene_idx on public.cineblock_lighting(shot_id,scene_id);
create index if not exists cineblock_lighting_updated_by_idx on public.cineblock_lighting(updated_by);
create index if not exists cineblock_props_shot_scene_idx on public.cineblock_props(shot_id,scene_id);
create index if not exists cineblock_props_updated_by_idx on public.cineblock_props(updated_by);
create index if not exists cineblock_movements_updated_by_idx on public.cineblock_movements(updated_by);
create index if not exists projects_owner_id_idx on public.projects(owner_id);
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = pg_catalog.now(); return new; end; $$;
revoke all on function public.cineblock_touch_versioned_row() from public, anon, authenticated;
revoke all on function public.cineblock_prevent_project_owner_change() from public, anon, authenticated;
revoke all on function public.cineblock_touch_project() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
