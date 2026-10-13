-- Additive hardening for the existing import RPC. Does not alter table structure.
CREATE OR REPLACE FUNCTION public.cineblock_import_local_project(
  p_project_id uuid, p_project_name text, p_project_info jsonb,
  p_scenes jsonb, p_shots jsonb, p_floorplan_elements jsonb,
  p_cameras jsonb, p_actors jsonb, p_lighting jsonb, p_props jsonb,
  p_movements jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_role text; v_result jsonb; v_total_bytes bigint;
BEGIN
  SELECT private.cineblock_project_role(p_project_id) INTO v_role;
  IF v_role IS DISTINCT FROM 'owner' AND v_role IS DISTINCT FROM 'editor' THEN
    RAISE EXCEPTION 'Not authorized to import into this project' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.cineblock_projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project not found or not accessible' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(coalesce(p_project_info, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Project info must be a JSON object' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(coalesce(p_scenes, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(coalesce(p_scenes, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'At least one scene is required for local import' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(coalesce(p_shots, '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(coalesce(p_floorplan_elements, '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(coalesce(p_cameras, '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(coalesce(p_actors, '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(coalesce(p_lighting, '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(coalesce(p_props, '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(coalesce(p_movements, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Import collections must be JSON arrays' USING ERRCODE = '22023';
  END IF;
  v_total_bytes :=
    octet_length(coalesce(p_project_info, '{}'::jsonb)::text)::bigint +
    octet_length(coalesce(p_scenes, '[]'::jsonb)::text)::bigint +
    octet_length(coalesce(p_shots, '[]'::jsonb)::text)::bigint +
    octet_length(coalesce(p_floorplan_elements, '[]'::jsonb)::text)::bigint +
    octet_length(coalesce(p_cameras, '[]'::jsonb)::text)::bigint +
    octet_length(coalesce(p_actors, '[]'::jsonb)::text)::bigint +
    octet_length(coalesce(p_lighting, '[]'::jsonb)::text)::bigint +
    octet_length(coalesce(p_props, '[]'::jsonb)::text)::bigint +
    octet_length(coalesce(p_movements, '[]'::jsonb)::text)::bigint;
  IF v_total_bytes > 8 * 1024 * 1024 THEN
    RAISE EXCEPTION 'Import payload exceeds the 8 MiB limit' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(p_shots, '[]'::jsonb)) s
    WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_scenes) sc WHERE sc->>'id' = s->>'scene_id')
  ) THEN RAISE EXCEPTION 'Import shot references a scene outside this import' USING ERRCODE = '22023'; END IF;

  IF EXISTS (
    SELECT 1 FROM (
      SELECT e AS item FROM jsonb_array_elements(coalesce(p_floorplan_elements, '[]'::jsonb)) e
      UNION ALL SELECT e FROM jsonb_array_elements(coalesce(p_cameras, '[]'::jsonb)) e
      UNION ALL SELECT e FROM jsonb_array_elements(coalesce(p_actors, '[]'::jsonb)) e
      UNION ALL SELECT e FROM jsonb_array_elements(coalesce(p_lighting, '[]'::jsonb)) e
      UNION ALL SELECT e FROM jsonb_array_elements(coalesce(p_props, '[]'::jsonb)) e
    ) child
    WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_scenes) sc WHERE sc->>'id' = child.item->>'scene_id')
       OR (nullif(child.item->>'shot_id', '') IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(coalesce(p_shots, '[]'::jsonb)) sh
         WHERE sh->>'id' = child.item->>'shot_id' AND sh->>'scene_id' = child.item->>'scene_id'
       ))
  ) THEN RAISE EXCEPTION 'Import element references a scene or shot outside this import' USING ERRCODE = '22023'; END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(p_movements, '[]'::jsonb)) mv
    WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_shots, '[]'::jsonb)) sh WHERE sh->>'id' = mv->>'shot_id')
  ) THEN RAISE EXCEPTION 'Import movement references a shot outside this import' USING ERRCODE = '22023'; END IF;

  v_result := private.cineblock_import_local_project_internal(
    p_project_id, p_project_name, p_project_info, p_scenes, p_shots,
    p_floorplan_elements, p_cameras, p_actors, p_lighting, p_props, p_movements
  );
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.cineblock_import_local_project(uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cineblock_import_local_project(uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) TO authenticated;
