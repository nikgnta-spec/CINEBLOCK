import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const edge = await readFile(new URL('../supabase/functions/cineblock-project-access/index.ts', import.meta.url), 'utf8')
const client = await readFile(new URL('../src/lib/supabaseClient.js', import.meta.url), 'utf8')
const workspace = await readFile(new URL('../src/components/AuthWorkspace.jsx', import.meta.url), 'utf8')
const ownerMigration = await readFile(new URL('../supabase/migrations/20261014130000_cineblock_owner_only_project_creation.sql', import.meta.url), 'utf8')
const quotaMigration = await readFile(new URL('../supabase/migrations/20261014121000_cineblock_atomic_invitation_quota.sql', import.meta.url), 'utf8')
const authGate = await readFile(new URL('../src/AuthGate.jsx', import.meta.url), 'utf8')

test('project access endpoint requires a valid session and project owner role', () => {
  assert.match(edge, /auth\.getUser\(jwt\)/)
  assert.match(edge, /if \(!isOwner\) return reply\(403/)
  assert.match(edge, /role !== "editor" && role !== "viewer"/)
})

test('project access endpoint never trusts client-provided identity or owner role', () => {
  assert.doesNotMatch(edge, /body\.user_id\s*\|\|\s*caller\.id/)
  assert.match(edge, /SUPABASE_SERVICE_ROLE_KEY/)
  assert.match(edge, /admin\.from\("cineblock_project_members"\)/)
  assert.match(edge, /role !== "editor" && role !== "viewer"/)
})

test('only the CineBlock operator can create cloud projects', () => {
  assert.match(ownerMigration, /drop policy if exists cineblock_projects_insert_owner/)
  assert.match(ownerMigration, /auth\.uid\(\) = 'cf4a51e8-825e-4db4-8b8a-037d3908663c'::uuid/)
  assert.match(ownerMigration, /owner_id = 'cf4a51e8-825e-4db4-8b8a-037d3908663c'::uuid/)
  assert.match(authGate, /session\?\.user\?\.id === 'cf4a51e8-825e-4db4-8b8a-037d3908663c'/)
  assert.match(authGate, /Hubungi pemilik CineBlock untuk meminta akses/)
  assert.match(workspace, /const isCineBlockOwner = session\?\.user\?\.id === 'cf4a51e8-825e-4db4-8b8a-037d3908663c'/)
})

test('invitation quota is atomic and unavailable to ordinary users', () => {
  assert.match(quotaMigration, /pg_advisory_xact_lock/)
  assert.match(quotaMigration, /v_count >= 8/)
  assert.match(quotaMigration, /from public, anon, authenticated/)
  assert.match(quotaMigration, /to service_role/)
  assert.match(edge, /cineblock_consume_invitation_quota/)
})

test('only the CineBlock owner sees project access management controls', () => {
  assert.match(workspace, /isCineBlockOwner && projects\.length > 0 && selectedProjectId/)
  assert.match(workspace, /accessOpen && isCineBlockOwner && selectedProjectId/)
  assert.doesNotMatch(workspace, /Undang melalui email/)
  assert.match(workspace, /Bagikan dengan link/)
  assert.match(workspace, /value="editor"/)
  assert.match(workspace, /value="viewer"/)
  assert.match(workspace, /manageAccess\('remove'/)
  assert.match(client, /functions\/v1\/cineblock-project-access/)
})

test('new users can sign up and existing users can log in or recover password', () => {
  assert.match(client, /signUpWithPassword/)
  assert.match(client, /authRequest\('signup'/)
  assert.match(client, /requestPasswordRecovery/)
  assert.match(authGate, /Sign up/)
  assert.match(authGate, /Log in/)
  assert.match(authGate, /setAuthMode\('signup'\)/)
  assert.match(authGate, /setAuthMode\('login'\)/)
})

test('cloud project creation uses server-verified owner identity and never sends ownerId from the browser', () => {
  assert.match(edge, /action === "create_project"/)
  assert.match(edge, /caller\.id !== "cf4a51e8-825e-4db4-8b8a-037d3908663c"/)
  assert.match(edge, /\.insert\(\{ name, owner_id: caller\.id, payload: \{\}, revision: 1 \}\)/)
  assert.match(client, /functions\/v1\/cineblock-project-access/)
  assert.doesNotMatch(client, /createProject\(\{\s*name,\s*ownerId\s*\}\)/)
  assert.match(workspace, /supabaseClient\.createProject\(\{ name: newProjectName\.trim\(\)\.slice\(0, 160\) \}\)/)
})

test('CineBlock keeps the auth session in persistent browser storage and refreshes it when needed', () => {
  assert.match(client, /SESSION_KEY = 'cineblock\.supabase\.session\.v1'/)
  assert.match(client, /localStorage\?\.getItem\(SESSION_KEY\)/)
  assert.match(client, /localStorage\?\.setItem\(SESSION_KEY, JSON\.stringify\(session\)\)/)
  assert.match(client, /token\?grant_type=refresh_token/)
})


test('owner session can enter local workspace when cloud project is empty', () => {
  assert.match(authGate, /session\.user\?\.id === 'cf4a51e8-825e-4db4-8b8a-037d3908663c'.*!\['invite', 'recovery'\]\.includes\(session\.auth_flow\).*!cloudWorkspace/s)
  assert.match(authGate, /Do not force an empty cloud/)
})

test('project sharing control is visible only to the CineBlock owner account', () => {
  assert.match(workspace, /const isCineBlockOwner = session\?\.user\?\.id === 'cf4a51e8-825e-4db4-8b8a-037d3908663c'/)
  assert.match(workspace, /isCineBlockOwner && projects\.length > 0 && selectedProjectId/)
  assert.match(workspace, /Bagikan proyek/)
})


test('project sharing supports viewer/editor links, revocation, and authenticated redemption', () => {
  assert.match(edge, /action === "create_link"/)
  assert.match(edge, /action === "revoke_link"/)
  assert.match(edge, /action === "list_links"/)
  assert.match(edge, /action === "redeem_link"/)
  assert.match(edge, /cineblock_share_links/)
  assert.match(workspace, /Bagikan dengan link/)
  assert.match(workspace, /Viewer — hanya melihat/)
  assert.match(workspace, /Editor — dapat mengubah proyek/)
  assert.match(workspace, /Salin link/)
  assert.match(workspace, /Cabut/)
})
