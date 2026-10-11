import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migrationUrl = new URL('../supabase/migrations/202610110001_cineblock_cloud_storage.sql', import.meta.url)

test('cloud migration is additive and preserves the legacy projects table', async () => {
  const sql = await readFile(migrationUrl, 'utf8')
  assert.match(sql, /create table if not exists public\.cineblock_projects/i)
  assert.match(sql, /create table if not exists public\.cineblock_project_members/i)
  assert.doesNotMatch(sql, /drop table\s+(if exists\s+)?public\.projects/i)
})

test('cloud tables use RLS and authenticated owner checks', async () => {
  const sql = await readFile(migrationUrl, 'utf8')
  assert.match(sql, /alter table public\.cineblock_projects enable row level security/i)
  assert.match(sql, /alter table public\.cineblock_project_members enable row level security/i)
  assert.match(sql, /owner_id = \(select auth\.uid\(\)\)/i)
  assert.match(sql, /role in \('editor', 'viewer'\)/i)
})

test('shared-member write access is not enabled before conflict-safe sync exists', async () => {
  const sql = await readFile(migrationUrl, 'utf8')
  assert.match(sql, /Members may read shared project payloads[\s\S]*?Editing is owner-only/i)
  assert.doesNotMatch(sql, /on public\.cineblock_projects for update to authenticated[\s\S]{0,180}user_id = \(select auth\.uid\(\)\)/i)
})
