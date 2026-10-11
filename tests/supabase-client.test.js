import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const clientPath = new URL('../src/lib/supabaseClient.js', import.meta.url)

test('Supabase client uses the publishable-key config and remains optional for local-first startup', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.match(source, /createClient\(config\.url, config\.publishableKey/)
  assert.match(source, /export const supabase = config[\s\S]*?\? createClient[\s\S]*?: null/)
  assert.match(source, /persistSession: true/)
  assert.doesNotMatch(source, /service_role|sb_secret/i)
})

test('connection check is read-only and requests only a project id', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.match(source, /\.from\('cineblock_projects'\)[\s\S]*?\.select\('id'\)[\s\S]*?\.limit\(1\)/)
  assert.doesNotMatch(source, /\.insert\(|\.update\(|\.delete\(/)
})
