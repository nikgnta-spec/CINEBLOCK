import { supabaseClient, OptimisticConflictError } from './supabaseClient.js'
import { cineblockRepository } from './cineblockRepository.js'

const BASELINE_PREFIX = 'cineblock.cloud-baseline.v1:'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function stable(value) {
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
  const baseline = { version: 1, scenes: {}, shots: {}, initializedAt: new Date().toISOString() }

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
      if (base && stable(localMovements) !== stable(base.movements || [])) {
        conflicts.push('Movement pada shot ' + (shot.num || shot.id) + ' berubah; sinkronisasi Movement belum diaktifkan.')
        continue
      }
      if (!base && !remoteRow) {
        try {
          const row = await supabaseClient.insertRow('cineblock_shots', { id: shot.id, scene_id: scene.id, ...projection })
          for (let movementIndex = 0; movementIndex < localMovements.length; movementIndex += 1) {
            const movement = localMovements[movementIndex]
            if (typeof movement === 'string' && movement.trim()) await supabaseClient.insertRow('cineblock_movements', { id: crypto.randomUUID(), shot_id: shot.id, movement_type: movement.slice(0, 120), position: movementIndex, properties: {} })
          }
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

  if (conflicts.length === 0) {
    const refreshed = await fetchRemoteWorkspace(projectId)
    const scenesById = new Map((workspace.scenes || []).map(scene => [scene.id, scene]))
    const shotsById = new Map((workspace.scenes || []).flatMap(scene => (scene.shots || []).map(shot => [shot.id, shot])))
    const nextBaseline = { version: 1, scenes: {}, shots: {}, initializedAt: new Date().toISOString() }
    for (const row of refreshed.scenes) {
      const local = scenesById.get(row.id)
      if (local) nextBaseline.scenes[row.id] = { version: row.version, local: sceneProjection(local, row.position) }
    }
    for (const row of refreshed.shots) {
      const local = shotsById.get(row.id)
      if (local) nextBaseline.shots[row.id] = { version: row.version, local: shotProjection(local, row.position), movements: [...(local.movements || [])] }
    }
    writeBaseline(projectId, nextBaseline)
  } else {
    writeBaseline(projectId, baseline)
  }

  return { updated, inserted, unchanged, conflicts }
}
