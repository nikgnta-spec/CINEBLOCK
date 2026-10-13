import test from 'node:test'
import assert from 'node:assert/strict'
import { mapLocalWorkspaceToRelational } from '../src/lib/cineblockImport.js'

test('local workspace maps to relational scene, shot, and separate floorplan rows', () => {
  const sceneId = '11111111-1111-4111-8111-111111111111'
  const shotId = '22222222-2222-4222-8222-222222222222'
  const roomId = '33333333-3333-4333-8333-333333333333'
  const cameraId = '44444444-4444-4444-8444-444444444444'
  const mapped = mapLocalWorkspaceToRelational({
    project: { title: 'Demo', director: 'Director' },
    scenes: [{
      id: sceneId, name: 'Scene 01', location: 'Room', intExt: 'INT', dayNight: 'NIGHT',
      shots: [{ id: shotId, subject: 'Actor', movements: ['Pan'], equipment: ['Tripod'], status: 'planned' }],
    }],
    floorplans: {
      [sceneId]: {
        rooms: [{ id: roomId, x: 1, y: 2, width: 100, height: 80, label: 'Room A', openings: [{ id: '55555555-5555-4555-8555-555555555555', type: 'door', offset: 0.3, width: 48 }] }],
        walls: [{ id: '66666666-6666-4666-8666-666666666666', x1: 1, y1: 2, x2: 10, y2: 2, thickness: 6, openings: [] }],
        cameras: [{ id: cameraId, shotId, label: 'Cam A', x: 10, y: 20, angle: 90, movement: 'Static', path: [] }],
        actors: [{ id: '77777777-7777-4777-8777-777777777777', label: 'Actor 1', x: 4, y: 5, path: [] }],
        lights: [{ id: '88888888-8888-4888-8888-888888888888', label: 'Key', lightType: 'Key', x: 6, y: 7 }],
        props: [{ id: '99999999-9999-4999-8999-999999999999', label: 'Table', propType: 'Furniture', x: 8, y: 9, width: 52, height: 36 }],
      },
    },
  })
  assert.equal(mapped.scenes.length, 1)
  assert.equal(mapped.shots.length, 1)
  assert.equal(mapped.shots[0].scene_id, sceneId)
  assert.deepEqual(mapped.shots[0].equipment, ['Tripod'])
  assert.equal(mapped.movements.length, 1)
  assert.equal(mapped.movements[0].shot_id, shotId)
  assert.equal(mapped.floorplan.filter(item => item.element_type === 'room').length, 1)
  assert.equal(mapped.floorplan.filter(item => item.element_type === 'opening').length, 1)
  assert.equal(mapped.cameras[0].shot_id, shotId)
  assert.equal(mapped.actors.length, 1)
  assert.equal(mapped.lighting.length, 1)
  assert.equal(mapped.props.length, 1)
  assert.equal(mapped.projectInfo.title, 'Demo')
})

test('local workspace with no scenes is rejected before any remote request', () => {
  assert.throws(() => mapLocalWorkspaceToRelational({ scenes: [] }), /belum memiliki scene/)
})
