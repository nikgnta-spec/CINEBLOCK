-- Atomic initial import from the local-first browser workspace.
-- The payload uses JSON arrays only as RPC transport; each entity is stored as a relational row.
alter table public.cineblock_shots add column if not exists equipment text[] not null default '{}';

create or replace function public.cineblock_import_local_project(
  p_project_id uuid, p_project_name text, p_project_info jsonb, p_scenes jsonb, p_shots jsonb,
  p_floorplan_elements jsonb, p_cameras jsonb, p_actors jsonb, p_lighting jsonb, p_props jsonb, p_movements jsonb
) returns jsonb language plpgsql set search_path = '' as $$
declare
  v_scene_count integer := 0; v_shot_count integer := 0; v_floorplan_count integer := 0;
  v_camera_count integer := 0; v_actor_count integer := 0; v_lighting_count integer := 0;
  v_prop_count integer := 0; v_movement_count integer := 0;
begin
  if (select private.cineblock_project_role(p_project_id)) not in ('owner','editor') then
    raise exception 'Not authorized to import into this project' using errcode = '42501';
  end if;
  if exists(select 1 from public.cineblock_scenes where project_id = p_project_id) then
    raise exception 'Cloud project is not empty; refusing to overwrite existing scenes' using errcode = '23505';
  end if;
  if jsonb_typeof(coalesce(p_scenes, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_scenes, '[]'::jsonb)) = 0 then
    raise exception 'At least one scene is required for local import' using errcode = '22023';
  end if;
  update public.cineblock_projects
    set name = left(coalesce(nullif(btrim(p_project_name), ''), 'Proyek tanpa judul'), 200),
        payload = case when jsonb_typeof(p_project_info) = 'object' then p_project_info else '{}'::jsonb end
    where id = p_project_id;

  insert into public.cineblock_scenes(id, project_id, name, location, int_ext, day_night, position, updated_by)
  select x.id, p_project_id, left(coalesce(x.name, 'Scene 01'), 120), coalesce(x.location, ''),
    coalesce(x.int_ext, 'INT'), coalesce(x.day_night, 'DAY'), greatest(0, coalesce(x.position, 0)), (select auth.uid())
  from jsonb_to_recordset(coalesce(p_scenes, '[]'::jsonb))
    as x(id uuid, name text, location text, int_ext text, day_night text, position integer);
  get diagnostics v_scene_count = row_count;

  insert into public.cineblock_shots(id, scene_id, position, subject, size, camera, angle, lens, status,
    storyboard_image, sound, take, script, setup, est_shoot, notes, equipment, updated_by)
  select x.id, x.scene_id, greatest(0, coalesce(x.position, 0)), coalesce(x.subject, ''), coalesce(x.size, ''),
    coalesce(x.camera, ''), coalesce(x.angle, ''), coalesce(x.lens, ''),
    case when x.status in ('planned','done','skip') then x.status else 'planned' end,
    coalesce(x.storyboard_image, ''), coalesce(x.sound, ''), coalesce(x.take, ''), coalesce(x.script, ''),
    coalesce(x.setup, ''), coalesce(x.est_shoot, ''), coalesce(x.notes, ''), coalesce(x.equipment, '{}'::text[]),
    (select auth.uid())
  from jsonb_to_recordset(coalesce(p_shots, '[]'::jsonb))
    as x(id uuid, scene_id uuid, position integer, subject text, size text, camera text, angle text, lens text,
      status text, storyboard_image text, sound text, take text, script text, setup text, est_shoot text, notes text, equipment text[]);
  get diagnostics v_shot_count = row_count;

  insert into public.cineblock_floorplan_elements(id, scene_id, shot_id, element_type, label, x, y, width, height, rotation, properties, updated_by)
  select x.id, x.scene_id, x.shot_id, x.element_type, coalesce(x.label, ''), coalesce(x.x, 0), coalesce(x.y, 0),
    coalesce(x.width, 0), coalesce(x.height, 0), coalesce(x.rotation, 0), coalesce(x.properties, '{}'::jsonb), (select auth.uid())
  from jsonb_to_recordset(coalesce(p_floorplan_elements, '[]'::jsonb))
    as x(id uuid, scene_id uuid, shot_id uuid, element_type text, label text, x double precision, y double precision,
      width double precision, height double precision, rotation double precision, properties jsonb);
  get diagnostics v_floorplan_count = row_count;

  insert into public.cineblock_cameras(id, scene_id, shot_id, label, x, y, angle, movement, path, properties, updated_by)
  select x.id, x.scene_id, x.shot_id, coalesce(x.label, ''), coalesce(x.x, 0), coalesce(x.y, 0), coalesce(x.angle, 0),
    coalesce(x.movement, ''), coalesce(x.path, '[]'::jsonb), coalesce(x.properties, '{}'::jsonb), (select auth.uid())
  from jsonb_to_recordset(coalesce(p_cameras, '[]'::jsonb))
    as x(id uuid, scene_id uuid, shot_id uuid, label text, x double precision, y double precision, angle double precision,
      movement text, path jsonb, properties jsonb);
  get diagnostics v_camera_count = row_count;

  insert into public.cineblock_actors(id, scene_id, shot_id, label, x, y, angle, path, properties, updated_by)
  select x.id, x.scene_id, x.shot_id, coalesce(x.label, ''), coalesce(x.x, 0), coalesce(x.y, 0), coalesce(x.angle, 0),
    coalesce(x.path, '[]'::jsonb), coalesce(x.properties, '{}'::jsonb), (select auth.uid())
  from jsonb_to_recordset(coalesce(p_actors, '[]'::jsonb))
    as x(id uuid, scene_id uuid, shot_id uuid, label text, x double precision, y double precision, angle double precision, path jsonb, properties jsonb);
  get diagnostics v_actor_count = row_count;

  insert into public.cineblock_lighting(id, scene_id, shot_id, label, light_type, x, y, angle, properties, updated_by)
  select x.id, x.scene_id, x.shot_id, coalesce(x.label, ''), coalesce(x.light_type, 'Key'), coalesce(x.x, 0),
    coalesce(x.y, 0), coalesce(x.angle, 0), coalesce(x.properties, '{}'::jsonb), (select auth.uid())
  from jsonb_to_recordset(coalesce(p_lighting, '[]'::jsonb))
    as x(id uuid, scene_id uuid, shot_id uuid, label text, light_type text, x double precision, y double precision, angle double precision, properties jsonb);
  get diagnostics v_lighting_count = row_count;

  insert into public.cineblock_props(id, scene_id, shot_id, label, prop_type, x, y, width, height, angle, locked, properties, updated_by)
  select x.id, x.scene_id, x.shot_id, coalesce(x.label, ''), coalesce(x.prop_type, 'Custom'), coalesce(x.x, 0),
    coalesce(x.y, 0), coalesce(x.width, 52), coalesce(x.height, 36), coalesce(x.angle, 0), coalesce(x.locked, false),
    coalesce(x.properties, '{}'::jsonb), (select auth.uid())
  from jsonb_to_recordset(coalesce(p_props, '[]'::jsonb))
    as x(id uuid, scene_id uuid, shot_id uuid, label text, prop_type text, x double precision, y double precision,
      width double precision, height double precision, angle double precision, locked boolean, properties jsonb);
  get diagnostics v_prop_count = row_count;

  insert into public.cineblock_movements(id, shot_id, movement_type, position, properties, updated_by)
  select x.id, x.shot_id, x.movement_type, greatest(0, coalesce(x.position, 0)), coalesce(x.properties, '{}'::jsonb), (select auth.uid())
  from jsonb_to_recordset(coalesce(p_movements, '[]'::jsonb))
    as x(id uuid, shot_id uuid, movement_type text, position integer, properties jsonb);
  get diagnostics v_movement_count = row_count;

  return jsonb_build_object('scenes', v_scene_count, 'shots', v_shot_count, 'floorplan', v_floorplan_count,
    'cameras', v_camera_count, 'actors', v_actor_count, 'lighting', v_lighting_count, 'props', v_prop_count, 'movements', v_movement_count);
end;
$$;
revoke all on function public.cineblock_import_local_project(uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.cineblock_import_local_project(uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) to authenticated;
