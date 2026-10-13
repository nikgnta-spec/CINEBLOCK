-- Harden the atomic local-import RPC without changing its established row mapping.
-- Rename the implementation out of the PostgREST-facing name and put a strict,
-- invoker-security guard in front of it. A project row lock serializes concurrent
-- imports targeting the same cloud project.
ALTER FUNCTION public.cineblock_import_local_project(
  uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) RENAME TO cineblock_import_local_project_internal;

REVOKE ALL ON FUNCTION public.cineblock_import_local_project_internal(
  uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.cineblock_import_local_project(
  p_project_id uuid,
  p_project_name text,
  p_project_info jsonb,
  p_scenes jsonb,
  p_shots jsonb,
  p_floorplan_elements jsonb,
  p_cameras jsonb,
  p_actors jsonb,
  p_lighting jsonb,
  p_props jsonb,
  p_movements jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_role text;
  v_result jsonb;
  v_total_bytes bigint;
BEGIN
  SELECT private.cineblock_project_role(p_project_id) INTO v_role;
  IF v_role IS DISTINCT FROM 'owner' AND v_role IS DISTINCT FROM 'editor' THEN
    RAISE EXCEPTION 'Not authorized to import into this project' USING ERRCODE = '42501';
  END IF;

  -- Lock a project row visible to this authenticated member. The lock persists
  -- through the nested implementation and prevents two imports racing the empty check.
  PERFORM 1
  FROM public.cineblock_projects
  WHERE id = p_project_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found or not accessible' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(coalesce(p_project_info, '{}'::jsonb)) NOT IN ('object', 'null') THEN
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

  v_result := public.cineblock_import_local_project_internal(
    p_project_id, p_project_name, p_project_info, p_scenes, p_shots,
    p_floorplan_elements, p_cameras, p_actors, p_lighting, p_props, p_movements
  );
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.cineblock_import_local_project(
  uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cineblock_import_local_project(
  uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) TO authenticated;
