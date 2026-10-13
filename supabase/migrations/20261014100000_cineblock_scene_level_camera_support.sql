-- Allow scene-level floorplan cameras and multiple camera elements per shot.
-- Additive/compatibility migration: no existing rows are deleted.
alter table public.cineblock_cameras alter column shot_id drop not null;
alter table public.cineblock_cameras drop constraint if exists cineblock_cameras_shot_id_key;
create index if not exists cineblock_cameras_shot_id_idx on public.cineblock_cameras(shot_id) where shot_id is not null;

drop policy if exists cineblock_cameras_select on public.cineblock_cameras;
drop policy if exists cineblock_cameras_insert on public.cineblock_cameras;
drop policy if exists cineblock_cameras_update on public.cineblock_cameras;
drop policy if exists cineblock_cameras_delete on public.cineblock_cameras;
create policy cineblock_cameras_select on public.cineblock_cameras for select to authenticated using (
  case when shot_id is null then private.cineblock_scene_role(scene_id) is not null
  else private.cineblock_shot_role(shot_id) is not null end
);
create policy cineblock_cameras_insert on public.cineblock_cameras for insert to authenticated with check (
  case when shot_id is null then private.cineblock_scene_role(scene_id) in ('owner','editor')
  else private.cineblock_shot_role(shot_id) in ('owner','editor') end
);
create policy cineblock_cameras_update on public.cineblock_cameras for update to authenticated using (
  case when shot_id is null then private.cineblock_scene_role(scene_id) in ('owner','editor')
  else private.cineblock_shot_role(shot_id) in ('owner','editor') end
) with check (
  case when shot_id is null then private.cineblock_scene_role(scene_id) in ('owner','editor')
  else private.cineblock_shot_role(shot_id) in ('owner','editor') end
);
create policy cineblock_cameras_delete on public.cineblock_cameras for delete to authenticated using (
  case when shot_id is null then private.cineblock_scene_role(scene_id) = 'owner'
  else private.cineblock_shot_role(shot_id) = 'owner' end
);
