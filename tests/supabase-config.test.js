import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const configPath = new URL('../src/lib/supabaseConfig.js', import.meta.url)
const examplePath = new URL('../.env.example', import.meta.url)

test('Supabase configuration reads only frontend-safe Vite variables', async () => {
  const source = await readFile(configPath, 'utf8')
  assert.match(source, /VITE_SUPABASE_URL/)
  assert.match(source, /VITE_SUPABASE_PUBLISHABLE_KEY/)
  assert.doesNotMatch(source, /service_role|sb_secret/i)
})

test('example environment file uses placeholders and warns against committing local secrets', async () => {
  const example = await readFile(examplePath, 'utf8')
  assert.match(example, /YOUR_PROJECT_ID/)
  assert.match(example, /YOUR_SUPABASE_PUBLISHABLE_KEY/)
  assert.match(example, /Never commit \.env\.local/)
  assert.doesNotMatch(example, /sb_secret_|service_role/i)
})
