export function removeReusableRoomRecords(rooms, roomIds) {
  const removedIds = roomIds instanceof Set ? roomIds : new Set(roomIds || [])
  return (Array.isArray(rooms) ? rooms : []).filter(room => !removedIds.has(room.id))
}

export function removeReusableRoomReferences(scenes, roomIds) {
  const removedIds = roomIds instanceof Set ? roomIds : new Set(roomIds || [])
  return (Array.isArray(scenes) ? scenes : []).map(scene => {
    if (!Array.isArray(scene.roomIds) || !scene.roomIds.some(id => removedIds.has(id))) return scene
    return { ...scene, roomIds: scene.roomIds.filter(id => !removedIds.has(id)) }
  })
}
