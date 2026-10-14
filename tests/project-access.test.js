import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const edge = await readFile(new URL('../supabase/functions/cineblock-project-access/index.ts', import.meta.url), 'utf8')
const client = await readFile(new URL('../src/lib/supabaseClient.js', import.meta.url), 'utf8')
const workspace = await readFile(new URL('../src/components/AuthWorkspace.jsx', import.meta.url), 'utf8')
const quotaMigration = await readFile(new URL('../supabase/migrations/20261014121000_cineblock_atomic_invitation_quota.sql', import.meta.url), 'utf8')
const authGate = await readFile(new URL('../src/AuthGate.jsx', import.meta.url), 'utf8')

test('project access endpoint requires a valid session and project owner role', () => {
  assert.match(edge, /auth\.getUser\(jwt\)/)
  assert.match(edge, /if \(!isOwner\) return reply\(403/)
  assert.match(edge, /role !== "editor" && role !== "viewer"/)
})

test('project access endpoint never trusts client-provided user identity or owner role', () => {
  assert.doesNotMatch(edge, /body\.user_id\s*\|\|\s*caller\.id/)
  assert.match(edge, /SUPABASE_SERVICE_ROLE_KEY/)
  assert.match(edge, /admin\.from\("cineblock_project_members"\)/)
  assert.match(edge, /role !== "editor" && role !== "viewer"/)
})

test('invitation quota is atomic and unavailable to ordinary users', () => {
  assert.match(quotaMigration, /pg_advisory_xact_lock/)
  assert.match(quotaMigration, /v_count >= 8/)
  assert.match(quotaMigration, /from public, anon, authenticated/)
  assert.match(quotaMigration, /to service_role/)
  assert.match(edge, /cineblock_consume_invitation_quota/)
})

test('workspace exposes invite, role selection, member listing and access revocation', () => {
  assert.match(workspace, /Kelola akses proyek/)
  assert.match(workspace, /Undang melalui email/)
  assert.match(workspace, /value="editor"/)
  assert.match(workspace, /value="viewer"/)
  assert.match(workspace, /manageAccess\('remove'/)
  assert.match(client, /functions\/v1\/cineblock-project-access/)
})


test('first account can recover or set a password without public signup', () => {
  assert.match(client, /requestPasswordRecovery/)
  assert.match(client, /authRequest\('recover'/)
  assert.match(client, /\['invite', 'signup', 'recovery', 'magiclink', 'email'\]/)
  assert.match(authGate, /Lupa \/ belum pernah mengatur kata sandi\?/)
  assert.match(authGate, /isPasswordSetup = isInvitation \|\| isRecovery/)
  assert.match(authGate, /showRecovery \? 'Atur ulang kata sandi'/)
  assert.doesNotMatch(authGate, /signUp\(|create_user:\s*true/)
})
