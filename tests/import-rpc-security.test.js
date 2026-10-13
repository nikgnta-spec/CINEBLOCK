import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('import RPC rejects cross-project scene and shot references before inserting imported rows', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20261014120000_harden_cineblock_import_relationship_validation.sql', import.meta.url), 'utf8')

  assert.match(migration, /SECURITY DEFINER/)
  assert.match(migration, /SET search_path TO ''/)
  assert.match(migration, /FOR UPDATE/)
  assert.match(migration, /shot references a scene outside this import/)
  assert.match(migration, /element references a scene or shot outside this import/)
  assert.match(migration, /movement references a shot outside this import/)
  assert.match(migration, /8 \* 1024 \* 1024/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.cineblock_import_local_project/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.cineblock_import_local_project[\s\S]*TO authenticated/)
})
