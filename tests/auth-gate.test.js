import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const gate = await readFile(new URL('../src/AuthGate.jsx', import.meta.url), 'utf8')
const entry = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8')

test('CineBlock entry point gates the workspace behind authentication', () => {
  assert.match(entry, /<AuthGate>\s*<App \/>\s*<\/AuthGate>/)
  assert.match(gate, /loadCloudWorkspace\(projectId\)/)
  assert.match(gate, /cloneElement\(children, \{ initialWorkspace: cloudWorkspace, cloudProjectId \}\)/)
  assert.match(gate, /setSelectedCloudProjectId/)
  assert.match(gate, /if \(localMode && !session\) return children/)
})

test('invitation activation requires a valid session and confirmed password input', () => {
  assert.match(gate, /session\?\.auth_flow === 'invite'/)
  assert.match(gate, /supabaseClient\.auth\.updatePassword\(\{ password: newPassword \}\)/)
  assert.match(gate, /newPassword !== confirmPassword/)
  assert.match(gate, /newPassword\.length < 8/)
})

test('login errors are communicated without exposing callback URLs or tokens', () => {
  assert.match(gate, /Email atau kata sandi tidak cocok/)
  assert.match(gate, /Tautan undangan sudah kedaluwarsa atau tidak berlaku/)
  assert.match(gate, /role="alert"/)
  assert.doesNotMatch(gate, /console\.(log|error)\(.*token/i)
})

test('local mode is an explicit choice and clearly distinguished from cloud', () => {
  assert.match(gate, /Buka mode lokal di perangkat ini/)
  assert.match(gate, /bukan sesi cloud/)
})

test('cloud project is selected before workspace initialization and local mode remains explicit', async () => {
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')
  assert.match(app, /initialWorkspace = null, cloudProjectId = ''/)
  assert.match(app, /if \(initialWorkspace && cloudProjectId\)/)
  assert.match(app, /setActiveProjectId\(cloudProjectId\)/)
  assert.match(gate, /Pilih proyek cloud/)
  assert.match(gate, /Workspace lokal tidak akan dibuka sebagai pengganti proyek cloud/)
})
