import { supabaseClient } from './supabaseClient.js'
import { cineblockRepository } from './cineblockRepository.js'
import { initializeCloudBaseline } from './cineblockSync.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function idMapper() {
  const ids = new Map()
  return value => {
    const key = String(value ?? '')
    if (!ids.has(key)) ids.set(key, UUID.test(key) ? key : crypto.randomUUID())
    return ids.get(key)
  }
}

export function mapLocalWorkspaceToRelational(workspace) {
  const localScenes = Array.isArray(workspace?.scenes) ? workspace.scenes : []
  if (!localScenes.length) throw new Error('Proyek lokal belum memiliki scene yang bisa diimpor.')
  if (localScenes.some(scene => !UUID.test(String(scene.id || '')) || (scene.shots || []).some(shot => !UUID.test(String(shot.id || ''))))) {
    throw new Error('ID Scene/Shot lokal tidak valid sebagai UUID. Impor dihentikan agar relasi dan OCC tetap konsisten.')
  }
  const sceneId = idMapper()
  const shotId = idMapper()
  const elementId = idMapper()
  const scenes = []
  const shots = []
  const floorplan = []
  const cameras = []
  const actors = []
  const lighting = []
  const props = []
  const movements = []

  for (let si = 0; si < localScenes.length; si += 1) {
    const scene = localScenes[si]
    const sid = sceneId(scene.id)
    const localShots = Array.isArray(scene.shots) ? scene.shots : []
    const validShots = new Set(localShots.map(shot => String(shot.id)))
    scenes.push({
      id: sid, name: String(scene.name || ('Scene ' + String(si + 1).padStart(2, '0'))).slice(0, 120),
      location: String(scene.location || ''),
      int_ext: ['INT', 'EXT', 'INT/EXT'].includes(scene.intExt) ? scene.intExt : 'INT',
      day_night: ['DAY', 'NIGHT', 'DAWN', 'DUSK'].includes(scene.dayNight) ? scene.dayNight : 'DAY',
      position: si,
    })
    for (let shi = 0; shi < localShots.length; shi += 1) {
      const shot = localShots[shi]
      const shid = shotId(shot.id)
      shots.push({
        id: shid, scene_id: sid, position: shi, subject: String(shot.subject || ''),
        size: String(shot.size || ''), camera: String(shot.camera || ''),
        angle: String(shot.angle || ''), lens: String(shot.lens || ''),
        status: ['planned', 'done', 'skip'].includes(shot.status) ? shot.status : 'planned',
        storyboard_image: String(shot.storyboardImage || ''), sound: String(shot.sound || ''),
        take: String(shot.take || ''), script: String(shot.script || ''),
        setup: String(shot.setup || ''), est_shoot: String(shot.estShoot || ''),
        notes: String(shot.notes || ''),
        equipment: Array.isArray(shot.equipment) ? shot.equipment.filter(x => typeof x === 'string') : [],
      })
      for (let mi = 0; mi < (shot.movements || []).length; mi += 1) {
        const movement = shot.movements[mi]
        if (typeof movement === 'string' && movement.trim()) movements.push({
          id: crypto.randomUUID(), shot_id: shid, movement_type: movement.slice(0, 120), position: mi, properties: {},
        })
      }
    }

    const fp = workspace?.floorplans?.[scene.id] || {}
    const addPlan = (item, type, properties, width, height) => floorplan.push({
      id: elementId(item.id), scene_id: sid, shot_id: null, element_type: type,
      label: String(item.label || '').slice(0, 120), x: Number(item.x) || 0, y: Number(item.y) || 0,
      width: Number(width ?? item.width) || 0, height: Number(height ?? item.height) || 0,
      rotation: Number(item.angle ?? item.rotation) || 0, properties,
    })
    for (const room of fp.rooms || []) {
      addPlan(room, 'room', { source: 'floorplan-room' })
      for (const opening of room.openings || []) addPlan(opening, 'opening', {
        host_id: elementId(room.id), host_type: 'room', side: opening.side || 'bottom',
        offset: Number(opening.offset) || 0.5, opening_type: opening.type === 'window' ? 'window' : 'door',
        width: Number(opening.width) || 48,
      })
    }
    for (const wall of fp.walls || []) {
      addPlan(wall, 'wall', {
        x1: Number(wall.x1) || 0, y1: Number(wall.y1) || 0, x2: Number(wall.x2) || 0,
        y2: Number(wall.y2) || 0, thickness: Number(wall.thickness) || 6,
      })
      for (const opening of wall.openings || []) addPlan(opening, 'opening', {
        host_id: elementId(wall.id), host_type: 'wall', offset: Number(opening.offset) || 0.5,
        opening_type: opening.type === 'window' ? 'window' : 'door', width: Number(opening.width) || 48,
      })
    }
    for (const item of fp.cameras || []) cameras.push({
      id: elementId(item.id), scene_id: sid,
      shot_id: item.shotId && validShots.has(String(item.shotId)) ? shotId(item.shotId) : null,
      label: String(item.label || 'Camera'), x: Number(item.x) || 0, y: Number(item.y) || 0,
      angle: Number(item.angle) || 0, movement: String(item.movement || 'Static'),
      path: Array.isArray(item.path) ? item.path : [], properties: {},
    })
    for (const item of fp.actors || []) actors.push({
      id: elementId(item.id), scene_id: sid, shot_id: null, label: String(item.label || 'Actor'),
      x: Number(item.x) || 0, y: Number(item.y) || 0, angle: Number(item.angle) || 0,
      path: Array.isArray(item.path) ? item.path : [],
      properties: { movement: String(item.movement || 'Blocking') },
    })
    for (const item of fp.lights || []) lighting.push({
      id: elementId(item.id), scene_id: sid, shot_id: null, label: String(item.label || 'Light'),
      light_type: String(item.lightType || 'Key'), x: Number(item.x) || 0, y: Number(item.y) || 0,
      angle: Number(item.angle) || 0,
      properties: { movement: String(item.movement || 'Static'), path: Array.isArray(item.path) ? item.path : [] },
    })
    for (const item of fp.props || []) props.push({
      id: elementId(item.id), scene_id: sid, shot_id: null, label: String(item.label || 'Prop'),
      prop_type: String(item.propType || 'Custom'), x: Number(item.x) || 0, y: Number(item.y) || 0,
      width: Number(item.width) || 52, height: Number(item.height) || 36,
      angle: Number(item.angle) || 0, locked: Boolean(item.locked), properties: {},
    })
  }

  return {
    projectName: String(workspace?.project?.title || 'Proyek tanpa judul').trim().slice(0, 200) || 'Proyek tanpa judul',
    projectInfo: workspace?.project && typeof workspace.project === 'object' ? workspace.project : {},
    scenes, shots, floorplan, cameras, actors, lighting, props, movements,
  }
}

export async function importLocalWorkspaceToCloud(projectId, workspace) {
  if (!projectId) throw new Error('Pilih proyek cloud terlebih dahulu.')
  const existingScenes = await cineblockRepository.listScenes(projectId)
  if (existingScenes.length) throw new Error('Proyek cloud sudah memiliki scene. Impor awal dihentikan agar data cloud tidak tertimpa.')
  const data = mapLocalWorkspaceToRelational(workspace)
  const result = await supabaseClient.rpc('cineblock_import_local_project', {
    p_project_id: projectId, p_project_name: data.projectName, p_project_info: data.projectInfo,
    p_scenes: data.scenes, p_shots: data.shots, p_floorplan_elements: data.floorplan,
    p_cameras: data.cameras, p_actors: data.actors, p_lighting: data.lighting,
    p_props: data.props, p_movements: data.movements,
  })
  try {
    await initializeCloudBaseline(projectId, workspace)
    return result
  } catch (error) {
    return { ...(result || {}), baselineWarning: error.message || 'Baseline OCC belum dapat disiapkan.' }
  }
}
