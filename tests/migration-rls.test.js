import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migrationPath = new URL('../supabase/migrations/202610110002_fix_membership_rls_recursion.sql', import.meta.url)

test('membership RLS migration uses a tightly scoped security-definer ownership helper', async () => {
  const sql = await readFile(migrationPath, 'utf8')
  assert.match(sql, /security definer/i)
  assert.match(sql, /set search_path\s*=\s*''/i)
  assert.match(sql, /revoke all on function public\.cineblock_is_project_owner\(uuid\) from public/i)
  assert.match(sql, /grant execute on function public\.cineblock_is_project_owner\(uuid\) to authenticated/i)
})

test('membership policies avoid querying the projects table under recursive RLS', async () => {
  const sql = await readFile(migrationPath, 'utf8')
  assert.match(sql, /create policy "CineBlock members can read memberships"[\s\S]*?using\s*\([\s\S]*?cineblock_is_project_owner\(project_id\)/i)
  assert.match(sql, /create policy "CineBlock owners can add memberships"[\s\S]*?with check\s*\(public\.cineblock_is_project_owner\(project_id\)\)/i)
  assert.match(sql, /create policy "CineBlock owners can remove memberships"[\s\S]*?using\s*\(public\.cineblock_is_project_owner\(project_id\)\)/i)
  assert.doesNotMatch(sql, /exists\s*\(\s*select 1 from public\.cineblock_projects/i)
})
