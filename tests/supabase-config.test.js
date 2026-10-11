import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseSupabaseConfig } from '../src/lib/supabaseConfig.js'

const configPath = new URL('../src/lib/supabaseConfig.js', import.meta.url)
const examplePath = new URL('../.env.example', import.meta.url)

test('Supabase configuration reads only frontend-safe Vite variables', async () => {
  const source = await readFile(configPath, 'utf8')
  assert.match(source, /VITE_SUPABASE_URL/)
  assert.match(source, /VITE_SUPABASE_PUBLISHABLE_KEY/)
  assert.doesNotMatch(source, /service_role|sb_secret/i)
})

test('valid Supabase URL and publishable key are normalized', () => {
  assert.deepEqual(parseSupabaseConfig(' https://example-project.supabase.co/ ', ' sb_publishable_test '), {
    url: 'https://example-project.supabase.co',
    publishableKey: 'sb_publishable_test',
  })
})

test('configuration rejects missing values, invalid domains, and insecure non-local URLs', () => {
  assert.equal(parseSupabaseConfig('', 'sb_publishable_test'), null)
  assert.equal(parseSupabaseConfig('https://example-project.supabase.co', ''), null)
  assert.equal(parseSupabaseConfig('https://example.com', 'sb_publishable_test'), null)
  assert.equal(parseSupabaseConfig('http://example-project.supabase.co', 'sb_publishable_test'), null)
  assert.equal(parseSupabaseConfig('not a url', 'sb_publishable_test'), null)
})

test('configuration rejects URLs with paths, credentials, query strings, or fragments', () => {
  assert.equal(parseSupabaseConfig('https://example-project.supabase.co/rest/v1', 'sb_publishable_test'), null)
  assert.equal(parseSupabaseConfig('https://user:pass@example-project.supabase.co', 'sb_publishable_test'), null)
  assert.equal(parseSupabaseConfig('https://example-project.supabase.co?debug=1', 'sb_publishable_test'), null)
  assert.equal(parseSupabaseConfig('https://example-project.supabase.co#fragment', 'sb_publishable_test'), null)
})

test('localhost HTTP is allowed for local development', () => {
  assert.deepEqual(parseSupabaseConfig('http://localhost:54321/', 'local-test-key'), {
    url: 'http://localhost:54321',
    publishableKey: 'local-test-key',
  })
})

test('example environment file uses placeholders and warns against committing local secrets', async () => {
  const example = await readFile(examplePath, 'utf8')
  assert.match(example, /YOUR_PROJECT_ID/)
  assert.match(example, /YOUR_SUPABASE_PUBLISHABLE_KEY/)
  assert.match(example, /Never commit \.env\.local/)
  assert.doesNotMatch(example, /sb_secret_|service_role/i)
})
