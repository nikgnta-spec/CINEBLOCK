import test from 'node:test'
import assert from 'node:assert/strict'
import { removeReusableRoomRecords, removeReusableRoomReferences } from '../src/utils/reusableRooms.js'

test('deleting a reusable Room removes its saved record and every Scene reference', () => {
  const rooms = [
    { id: 'room-a', label: 'Room A' },
    { id: 'room-b', label: 'Room B' },
  ]
  const scenes = [
    { id: 'scene-a', roomIds: ['room-a', 'room-b'] },
    { id: 'scene-b', roomIds: ['room-a'] },
    { id: 'scene-c', roomIds: ['room-b'] },
  ]

  assert.deepEqual(removeReusableRoomRecords(rooms, new Set(['room-a'])), [rooms[1]])
  assert.deepEqual(removeReusableRoomReferences(scenes, new Set(['room-a'])), [
    { id: 'scene-a', roomIds: ['room-b'] },
    { id: 'scene-b', roomIds: [] },
    scenes[2],
  ])
})
