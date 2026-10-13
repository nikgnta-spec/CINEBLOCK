import { supabaseClient, OptimisticConflictError } from './supabaseClient.js'
import { cineblockRepository } from './cineblockRepository.js'
import { mapLocalWorkspaceToRelational } from './cineblockImport.js'

const BASELINE_PREFIX = 'cineblock.cloud-baseline.v1:'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ENTITY_TABLES = ['cineblock_floorplan_elements', 'cineblock_cameras', 'cineblock_actors', 'cineblock_lighting', 'cineblock_props', 'cineblock_movements']

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}'
  return JSON.stringify(value)
}

function sceneProjection(scene, position) {
  return {
    name: String(scene.name || 'Scene 01'),
    location: String(scene.location || ''),
    int_ext: ['INT', 'EXT', 'INT/EXT'].includes(scene.intExt) ? scene.intExt : 'INT',
    day_night: ['DAY', 'NIGHT', 'DAWN', 'DUSK'].includes(scene.dayNight) ? scene.dayNight : 'DAY',
    position,
  }
}

function shotProjection(shot, position) {
  return {
    position,
    subject: String(shot.subject || ''),
    size: String(shot.size || ''),
    camera: String(shot.camera || ''),
    angle: String(shot.angle || ''),
    lens: String(shot.lens || ''),
    status: ['planned', 'done', 'skip'].includes(shot.status) ? shot.status : 'planned',
    storyboard_image: String(shot.storyboardImage || ''),
    sound: String(shot.sound || ''),
    take: String(shot.take || ''),
    script: String(shot.script || ''),
    setup: String(shot.setup || ''),
    est_shoot: String(shot.estShoot || ''),
    notes: String(shot.notes || ''),
    equipment: Array.isArray(shot.equipment) ? shot.equipment.filter(item => typeof item === 'string') : [],
  }
}


function entityProjection(row) {
  const result = { ...row }
  delete result.id
  delete result.created_at
  delete result.updated_at
  delete result.updated_by
  delete result.version
  return result
}

async function fetchRemoteEntities(remoteScenes, remoteShots) {
  const result = Object.fromEntries(ENTITY_TABLES.map(table => [table, []]))
  for (const scene of remoteScenes) {
    for (const table of ENTITY_TABLES.filter(item => item !== 'cineblock_movements')) {
      result[table].push(...await supabaseClient.selectRows(table, { scene_id: 'eq.' + scene.id }))
    }
  }
  for (const shot of remoteShots) result.cineblock_movements.push(...await supabaseClient.selectRows('cineblock_movements', { shot_id: 'eq.' + shot.id, order: 'position.asc' }))
  return result
}

function localEntities(workspace) {
  const mapped = mapLocalWorkspaceToRelational(workspace)
  return {
    cineblock_floorplan_elements: mapped.floorplan,
    cineblock_cameras: mapped.cameras,
    cineblock_actors: mapped.actors,
    cineblock_lighting: mapped.lighting,
    cineblock_props: mapped.props,
    cineblock_movements: mapped.movements,
  }
}


function alignMovementIds(localRows, referenceRows) {
  const idsByPosition = new Map((referenceRows || []).map(row => [String(row.shot_id) + ':' + String(row.position), row.id]))
  for (const row of localRows || []) {
    const id = idsByPosition.get(String(row.shot_id) + ':' + String(row.position))
    if (id) row.id = id
  }
}

async function canDeleteProjectRows(projectId) {
  const session = await supabaseClient.auth.getSession()
  const projects = await supabaseClient.listProjects()
  const project = projects.find(item => item.id === projectId)
  if (project && session?.user?.id === project.owner_id) return true
  const memberships = await supabaseClient.listProjectMemberships(projectId)
  return memberships.some(item => item.user_id === session?.user?.id && item.role === 'owner')
}

function readBaseline(projectId) {
  try {
    const value = localStorage.getItem(BASELINE_PREFIX + projectId)
    return value ? JSON.parse(value) : null
  } catch {
    return null
  }
}

function writeBaseline(projectId, baseline) {
  try {
    localStorage.setItem(BASELINE_PREFIX + projectId, JSON.stringify(baseline))
  } catch {
    throw new Error('Browser tidak dapat menyimpan baseline OCC. Sinkronisasi dibatalkan agar konflik tidak diabaikan.')
  }
}

async function fetchRemoteWorkspace(projectId) {
  const scenes = await cineblockRepository.listScenes(projectId)
  const shots = []
  for (const scene of scenes) shots.push(...await cineblockRepository.listShots(scene.id))
  return { scenes, shots }
}

export async function initializeCloudBaseline(projectId, workspace) {
  const remote = await fetchRemoteWorkspace(projectId)
  const localScenes = new Map((workspace.scenes || []).map(scene => [scene.id, scene]))
  const localShots = new Map((workspace.scenes || []).flatMap(scene => (scene.shots || []).map(shot => [shot.id, shot])))
  const baseline = { version: 1, scenes: {}, shots: {}, entities: {}, initializedAt: new Date().toISOString() }

  for (const row of remote.scenes) {
    const local = localScenes.get(row.id)
    if (!local) throw new Error('ID scene cloud tidak cocok dengan proyek lokal; baseline tidak dibuat.')
    baseline.scenes[row.id] = { version: row.version, local: sceneProjection(local, row.position) }
  }
  for (const row of remote.shots) {
    const local = localShots.get(row.id)
    if (!local) throw new Error('ID shot cloud tidak cocok dengan proyek lokal; baseline tidak dibuat.')
    baseline.shots[row.id] = { version: row.version, local: shotProjection(local, row.position), movements: [...(local.movements || [])] }
  }
  const localEntityRows = localEntities(workspace)
  const remoteEntityRows = await fetchRemoteEntities(remote.scenes, remote.shots)
  alignMovementIds(localEntityRows.cineblock_movements, remoteEntityRows.cineblock_movements)
  for (const table of ENTITY_TABLES) {
    const localById = new Map(localEntityRows[table].map(row => [row.id, row]))
    baseline.entities[table] = {}
    for (const row of remoteEntityRows[table]) {
      const local = localById.get(row.id)
      if (!local) throw new Error('ID elemen ' + table + ' di cloud tidak cocok dengan denah lokal; baseline tidak dibuat.')
      baseline.entities[table][row.id] = { version: row.version, local: entityProjection(local) }
    }
    if (remoteEntityRows[table].length !== localEntityRows[table].length) {
      throw new Error('Jumlah elemen ' + table + ' lokal dan cloud berbeda; baseline tidak dibuat.')
    }
  }
  if (remote.scenes.length !== localScenes.size || remote.shots.length !== localShots.size) {
    throw new Error('Jumlah scene/shot lokal dan cloud berbeda; baseline tidak dibuat.')
  }
  writeBaseline(projectId, baseline)
  return baseline
}

export async function syncLocalScenesAndShots(projectId, workspace) {
  if (!projectId) throw new Error('Pilih proyek cloud terlebih dahulu.')
  const baseline = readBaseline(projectId)
  if (!baseline) throw new Error('Baseline sinkronisasi belum tersedia di perangkat ini. Gunakan impor awal pada proyek cloud kosong atau muat data cloud terlebih dahulu.')
  const remote = await fetchRemoteWorkspace(projectId)
  const remoteScenes = new Map(remote.scenes.map(row => [row.id, row]))
  const remoteShots = new Map(remote.shots.map(row => [row.id, row]))
  const localScenes = new Map((workspace.scenes || []).map(scene => [scene.id, scene]))
  const localShots = new Map((workspace.scenes || []).flatMap(scene => (scene.shots || []).map(shot => [shot.id, shot])))
  const conflicts = []
  let updated = 0
  let inserted = 0
  let unchanged = 0

  for (const id of Object.keys(baseline.scenes)) {
    if (!localScenes.has(id)) conflicts.push('Scene ' + id + ' dihapus lokal; penghapusan cloud belum diaktifkan.')
    if (!remoteScenes.has(id)) conflicts.push('Scene ' + id + ' hilang dari cloud; perubahan lokal dipertahankan.')
  }
  for (const id of Object.keys(baseline.shots)) {
    if (!localShots.has(id)) conflicts.push('Shot ' + id + ' dihapus lokal; penghapusan cloud belum diaktifkan.')
    if (!remoteShots.has(id)) conflicts.push('Shot ' + id + ' hilang dari cloud; perubahan lokal dipertahankan.')
  }

  for (const row of remote.scenes) {
    if (!baseline.scenes[row.id] && !localScenes.has(row.id)) conflicts.push('Scene baru ditemukan di cloud (' + row.name + '); pemuatan cloud belum diaktifkan.')
  }
  for (const row of remote.shots) {
    if (!baseline.shots[row.id] && !localShots.has(row.id)) conflicts.push('Shot baru ditemukan di cloud (' + row.id + '); pemuatan cloud belum diaktifkan.')
  }

  for (let sceneIndex = 0; sceneIndex < (workspace.scenes || []).length; sceneIndex += 1) {
    const scene = workspace.scenes[sceneIndex]
    if (!UUID.test(scene.id)) {
      conflicts.push('Scene baru harus memiliki ID UUID sebelum disinkronkan.')
      continue
    }
    const projection = sceneProjection(scene, sceneIndex)
    const base = baseline.scenes[scene.id]
    const remoteRow = remoteScenes.get(scene.id)
    if (!base && !remoteRow) {
      try {
        const row = await supabaseClient.insertRow('cineblock_scenes', { id: scene.id, project_id: projectId, ...projection })
        baseline.scenes[scene.id] = { version: row.version, local: projection }
        inserted += 1
      } catch (error) {
        conflicts.push('Scene ' + scene.name + ': ' + error.message)
      }
    } else if (!base && remoteRow) {
      conflicts.push('Scene ' + scene.name + ' sudah ada di cloud tanpa baseline lokal.')
    } else if (base && remoteRow) {
      const localChanged = stable(projection) !== stable(base.local)
      if (!localChanged && remoteRow.version !== base.version) {
        conflicts.push('Scene ' + scene.name + ' berubah di cloud. Muat ulang/selesaikan konflik sebelum mengedit lagi.')
      } else if (localChanged && remoteRow.version !== base.version) {
        conflicts.push('Scene ' + scene.name + ' diubah bersamaan. Tidak ada perubahan yang ditimpa.')
      } else if (localChanged) {
        try {
          const result = await cineblockRepository.updateScene(scene.id, base.version, projection)
          baseline.scenes[scene.id] = { version: result.version, local: projection }
          updated += 1
        } catch (error) {
          conflicts.push(error instanceof OptimisticConflictError ? 'Scene ' + scene.name + ' konflik OCC; perubahan lokal dipertahankan.' : 'Scene ' + scene.name + ': ' + error.message)
        }
      } else {
        unchanged += 1
      }
    }
  }

  for (const scene of (workspace.scenes || [])) {
    for (let shotIndex = 0; shotIndex < (scene.shots || []).length; shotIndex += 1) {
      const shot = scene.shots[shotIndex]
      if (!UUID.test(shot.id) || !UUID.test(scene.id)) {
        conflicts.push('Shot baru harus memiliki ID UUID sebelum disinkronkan.')
        continue
      }
      const projection = shotProjection(shot, shotIndex)
      const base = baseline.shots[shot.id]
      const remoteRow = remoteShots.get(shot.id)
      const localMovements = Array.isArray(shot.movements) ? shot.movements : []
      if (!base && !remoteRow) {
        try {
          const row = await supabaseClient.insertRow('cineblock_shots', { id: shot.id, scene_id: scene.id, ...projection })
          baseline.shots[shot.id] = { version: row.version, local: projection, movements: localMovements }
          inserted += 1
        } catch (error) {
          conflicts.push('Shot ' + (shot.num || shot.id) + ': ' + error.message)
        }
      } else if (!base && remoteRow) {
        conflicts.push('Shot ' + (shot.num || shot.id) + ' sudah ada di cloud tanpa baseline lokal.')
      } else if (base && remoteRow) {
        const localChanged = stable(projection) !== stable(base.local)
        if (!localChanged && remoteRow.version !== base.version) {
          conflicts.push('Shot ' + (shot.num || shot.id) + ' berubah di cloud. Muat ulang/selesaikan konflik sebelum mengedit lagi.')
        } else if (localChanged && remoteRow.version !== base.version) {
          conflicts.push('Shot ' + (shot.num || shot.id) + ' diubah bersamaan. Tidak ada perubahan yang ditimpa.')
        } else if (localChanged) {
          try {
            const result = await cineblockRepository.updateShot(shot.id, base.version, projection)
            baseline.shots[shot.id] = { version: result.version, local: projection, movements: localMovements }
            updated += 1
          } catch (error) {
            conflicts.push(error instanceof OptimisticConflictError ? 'Shot ' + (shot.num || shot.id) + ' konflik OCC; perubahan lokal dipertahankan.' : 'Shot ' + (shot.num || shot.id) + ': ' + error.message)
          }
        } else {
          unchanged += 1
        }
      }
    }
  }

  const localEntityRows = localEntities(workspace)
  const remoteEntityRows = await fetchRemoteEntities(remote.scenes, remote.shots)
  const baseMovementRows = Object.entries(baseline.entities?.cineblock_movements || {}).map(([id, entry]) => ({ id, ...entry.local }))
  alignMovementIds(localEntityRows.cineblock_movements, baseMovementRows)
  baseline.entities ||= {}
  for (const table of ENTITY_TABLES) {
    const localById = new Map(localEntityRows[table].map(row => [row.id, row]))
    const remoteById = new Map(remoteEntityRows[table].map(row => [row.id, row]))
    baseline.entities[table] ||= {}
    for (const id of Object.keys(baseline.entities[table])) {
      const base = baseline.entities[table][id]
      if (!localById.has(id)) {
        if (!remoteById.has(id)) continue
        if (remoteById.get(id).version !== base.version) {
          conflicts.push('Elemen ' + id + ' pada ' + table + ' berubah di cloud; penghapusan dibatalkan oleh OCC.')
        } else {
          try {
            if (!await canDeleteProjectRows(projectId)) throw new Error('Hanya owner proyek yang dapat menghapus elemen cloud.')
            await supabaseClient.deleteVersionedRow(table, { id, expectedVersion: base.version })
            delete baseline.entities[table][id]
            updated += 1
          } catch (error) {
            conflicts.push('Elemen ' + id + ' pada ' + table + ': ' + error.message)
          }
        }
      } else if (!remoteById.has(id)) {
        conflicts.push('Elemen ' + id + ' pada ' + table + ' hilang dari cloud.')
      }
    }
    for (const row of remoteEntityRows[table]) {
      if (!baseline.entities[table][row.id] && !localById.has(row.id)) conflicts.push('Elemen baru ditemukan di cloud pada ' + table + '; pemuatan cloud belum diaktifkan.')
    }
    for (const row of localEntityRows[table]) {
      const id = row.id
      const base = baseline.entities[table][id]
      const remoteRow = remoteById.get(id)
      const projection = entityProjection(row)
      if (!base && !remoteRow) {
        try {
          const insertedRow = await supabaseClient.insertRow(table, row)
          baseline.entities[table][id] = { version: insertedRow.version, local: projection }
          inserted += 1
        } catch (error) {
          conflicts.push('Elemen ' + id + ' pada ' + table + ': ' + error.message)
        }
      } else if (!base && remoteRow) {
        conflicts.push('Elemen ' + id + ' pada ' + table + ' sudah ada di cloud tanpa baseline.')
      } else if (base && !remoteRow) {
        // The earlier deletion check reports this; preserve the local element.
      } else if (base && remoteRow) {
        const localChanged = stable(projection) !== stable(base.local)
        if (!localChanged && remoteRow.version !== base.version) {
          conflicts.push('Elemen ' + id + ' pada ' + table + ' berubah di cloud; tidak ada perubahan yang ditimpa.')
        } else if (localChanged && remoteRow.version !== base.version) {
          conflicts.push('Elemen ' + id + ' pada ' + table + ' konflik OCC; perubahan lokal dipertahankan.')
        } else if (localChanged) {
          try {
            const result = await supabaseClient.updateVersionedRow(table, { id, expectedVersion: base.version, changes: projection })
            baseline.entities[table][id] = { version: result.version, local: projection }
            updated += 1
          } catch (error) {
            conflicts.push('Elemen ' + id + ' pada ' + table + ': ' + error.message)
          }
        } else {
          unchanged += 1
        }
      }
    }
  }

  if (conflicts.length === 0) {
    await initializeCloudBaseline(projectId, workspace)
  } else {
    writeBaseline(projectId, baseline)
  }

  return { updated, inserted, unchanged, conflicts }
}
