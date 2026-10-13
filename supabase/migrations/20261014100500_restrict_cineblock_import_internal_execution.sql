-- Keep the implementation callable only by the guarded public wrapper.
-- The wrapper performs authorization itself and has a fixed empty search_path.
ALTER FUNCTION public.cineblock_import_local_project(
  uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) SECURITY DEFINER;

REVOKE ALL ON FUNCTION private.cineblock_import_local_project_internal(
  uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON SCHEMA private FROM anon;
GRANT USAGE ON SCHEMA private TO authenticated;

REVOKE ALL ON FUNCTION public.cineblock_import_local_project(
  uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cineblock_import_local_project(
  uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) TO authenticated;
