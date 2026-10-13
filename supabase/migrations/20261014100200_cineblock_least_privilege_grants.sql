-- Least-privilege API grants for CineBlock relational tables.
-- RLS remains the row-level authorization boundary; table grants additionally
-- remove TRUNCATE/trigger/reference privileges that RLS does not protect.
REVOKE ALL PRIVILEGES ON TABLE
  public.cineblock_projects,
  public.cineblock_project_members,
  public.cineblock_scenes,
  public.cineblock_shots,
  public.cineblock_floorplan_elements,
  public.cineblock_cameras,
  public.cineblock_actors,
  public.cineblock_lighting,
  public.cineblock_props,
  public.cineblock_movements
FROM anon;

REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.cineblock_projects,
  public.cineblock_project_members,
  public.cineblock_scenes,
  public.cineblock_shots,
  public.cineblock_floorplan_elements,
  public.cineblock_cameras,
  public.cineblock_actors,
  public.cineblock_lighting,
  public.cineblock_props,
  public.cineblock_movements
FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.cineblock_projects,
  public.cineblock_project_members,
  public.cineblock_scenes,
  public.cineblock_shots,
  public.cineblock_floorplan_elements,
  public.cineblock_cameras,
  public.cineblock_actors,
  public.cineblock_lighting,
  public.cineblock_props,
  public.cineblock_movements
TO authenticated;

REVOKE ALL ON FUNCTION public.cineblock_import_local_project(
  uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cineblock_import_local_project(
  uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) TO authenticated;
