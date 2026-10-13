import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAuthCallbackUrl } from '../src/lib/supabaseClient.js'

test('parses Supabase invitation tokens from query parameters and removes secrets from clean URL', () => {
  const callback = parseAuthCallbackUrl('https://cineblock-nu.vercel.app/?access_token=access-secret&refresh_token=refresh-secret&expires_in=3600&token_type=bearer&type=invite')

  assert.equal(callback.type, 'invite')
  assert.equal(callback.access_token, 'access-secret')
  assert.equal(callback.refresh_token, 'refresh-secret')
  assert.equal(callback.expires_in, 3600)
  assert.equal(callback.cleanUrl, 'https://cineblock-nu.vercel.app/')
  assert.equal(callback.cleanUrl.includes('access-secret'), false)
})

test('parses Supabase invitation tokens from URL fragment', () => {
  const callback = parseAuthCallbackUrl('https://cineblock-nu.vercel.app/#access_token=access-secret&refresh_token=refresh-secret&type=invite')

  assert.equal(callback.type, 'invite')
  assert.equal(callback.access_token, 'access-secret')
  assert.equal(callback.refresh_token, 'refresh-secret')
  assert.equal(callback.cleanUrl, 'https://cineblock-nu.vercel.app/')
})

test('returns null for normal application URLs', () => {
  assert.equal(parseAuthCallbackUrl('https://cineblock-nu.vercel.app/?tab=floorplan'), null)
})

test('captures Supabase callback errors without retaining their query string', () => {
  const callback = parseAuthCallbackUrl('https://cineblock-nu.vercel.app/?error=access_denied&error_description=Invite+expired&type=invite')

  assert.equal(callback.error, 'access_denied')
  assert.equal(callback.error_description, 'Invite expired')
  assert.equal(callback.cleanUrl, 'https://cineblock-nu.vercel.app/')
})
