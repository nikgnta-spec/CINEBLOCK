import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { checkSupabaseConnectionWithClient } from '../src/lib/supabaseConnection.js'

const clientPath = new URL('../src/lib/supabaseClient.js', import.meta.url)

test('Supabase client uses the publishable-key config and remains optional for local-first startup', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.match(source, /createClient\(config\.url, config\.publishableKey/)
  assert.match(source, /export const supabase = config[\s\S]*?\? createClient[\s\S]*?: null/)
  assert.match(source, /persistSession: true/)
  assert.doesNotMatch(source, /service_role|sb_secret/i)
})

test('connection check handles missing configuration without throwing', async () => {
  assert.deepEqual(await checkSupabaseConnectionWithClient(null), {
    connected: false,
    code: 'not_configured',
    message: 'Supabase belum dikonfigurasi. Periksa .env.local lalu restart Vite.',
  })
})

test('connection check is read-only and reports a successful empty RLS result as reachable', async () => {
  const calls = []
  const client = {
    from(table) {
      calls.push(['from', table])
      return {
        select(columns) {
          calls.push(['select', columns])
          return {
            async limit(count) {
              calls.push(['limit', count])
              return { data: [], error: null }
            },
          }
        },
      }
    },
  }

  const result = await checkSupabaseConnectionWithClient(client)
  assert.equal(result.connected, true)
  assert.equal(result.code, 'ok')
  assert.deepEqual(calls, [
    ['from', 'cineblock_projects'],
    ['select', 'id'],
    ['limit', 1],
  ])
})

test('connection check classifies thrown DNS/network failures instead of rejecting', async () => {
  const client = {
    from() {
      return {
        select() {
          return {
            limit() {
              throw new TypeError('Failed to fetch')
            },
          }
        },
      }
    },
  }

  const result = await checkSupabaseConnectionWithClient(client)
  assert.equal(result.connected, false)
  assert.equal(result.code, 'network_error')
  assert.match(result.message, /Project URL, DNS/)
})

test('connection check preserves database/API error codes and messages', async () => {
  const client = {
    from() {
      return {
        select() {
          return {
            async limit() {
              return { data: null, error: { code: '42P01', message: 'relation does not exist' } }
            },
          }
        },
      }
    },
  }

  const result = await checkSupabaseConnectionWithClient(client)
  assert.equal(result.connected, false)
  assert.equal(result.code, '42P01')
  assert.equal(result.message, 'relation does not exist')
})
