import { supabaseClient } from './supabaseClient.js'

export const CINEBLOCK_TABLES = Object.freeze({
  scenes: 'cineblock_scenes',
  shots: 'cineblock_shots',
  floorplan: 'cineblock_floorplan_elements',
  cameras: 'cineblock_cameras',
  actors: 'cineblock_actors',
  lighting: 'cineblock_lighting',
  props: 'cineblock_props',
  movements: 'cineblock_movements',
})

export const cineblockRepository = Object.freeze({
  listScenes(projectId) {
    return supabaseClient.selectRows(CINEBLOCK_TABLES.scenes, { project_id: `eq.${projectId}`, order: 'position.asc' })
  },
  listShots(sceneId) {
    return supabaseClient.selectRows(CINEBLOCK_TABLES.shots, { scene_id: `eq.${sceneId}`, order: 'position.asc' })
  },
  listFloorplanElements(sceneId) {
    return supabaseClient.selectRows(CINEBLOCK_TABLES.floorplan, { scene_id: `eq.${sceneId}`, order: 'created_at.asc' })
  },
  updateScene(id, expectedVersion, changes) {
    return supabaseClient.updateVersionedRow(CINEBLOCK_TABLES.scenes, { id, expectedVersion, changes })
  },
  updateShot(id, expectedVersion, changes) {
    return supabaseClient.updateVersionedRow(CINEBLOCK_TABLES.shots, { id, expectedVersion, changes })
  },
  updateFloorplanElement(id, expectedVersion, changes) {
    return supabaseClient.updateVersionedRow(CINEBLOCK_TABLES.floorplan, { id, expectedVersion, changes })
  },
})
