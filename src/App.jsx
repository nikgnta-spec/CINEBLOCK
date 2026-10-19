import { useEffect, useRef, useState } from 'react'
import './App.css'
import ProjectInfo from './components/ProjectInfo'
import ShotList from './components/ShotList'
import Floorplan from './components/Floorplan'
import PrintReport from './components/PrintReport'
import { Download, Upload, Plus, Trash2, X, FileText, PanelsTopLeft, RectangleHorizontal, RectangleVertical, MoreHorizontal, Sun, Moon, Cloud } from 'lucide-react'
import { loadAppState, saveAppState, subscribeToExternalSave } from './storage'
import CloudSyncDialog from './components/CloudSyncDialog'
import {
  createCloudProject,
  createCloudShareLink,
  ensureCloudSession,
  fetchCloudProject,
  getSavedDisplayName,
  isCloudSyncConfigured,
  isEmptyCloudPayload,
  readCloudProjectMap,
  redeemCloudLink,
  saveCloudProject,
  subscribeToCloudProject,
  writeCloudProjectMap,
} from './cloudSync'

const MAX_BACKUP_FILE_SIZE_BYTES = 10 * 1024 * 1024

const TABS = [
  { id: 'floorplan', label: 'Floorplan' },
  { id: 'shotlist', label: 'Shot List' },
  { id: 'project', label: 'Info Proyek' },
]

const defaultProject = {
  title: '',
  director: '',
  dop: 'NIKOLAS GENTA',
  production: '',
  genre: '',
  duration: '',
  format: '',
  aspectRatio: '',
  camera: '',
  lensSystem: '',
  visualApproach: '',
  lightingApproach: '',
  visualRefs: [null, null, null, null, null, null],
  visualRefLabels: ['', '', '', '', '', ''],
}

function normalizeSavedProject(savedProject) {
  const refs = Array.isArray(savedProject?.visualRefs)
    ? savedProject.visualRefs
    : defaultProject.visualRefs
  const textFields = [
    'title', 'director', 'dop', 'production', 'genre', 'duration',
    'format', 'aspectRatio', 'camera', 'lensSystem', 'visualApproach',
    'lightingApproach',
  ]
  const safeTextFields = Object.fromEntries(
    textFields.map(key => [
      key,
      typeof savedProject?.[key] === 'string'
        ? savedProject[key].slice(0, key === 'visualApproach' || key === 'lightingApproach' ? 5000 : 300)
        : defaultProject[key],
    ]),
  )
  const refCount = Math.max(6, Math.min(24, refs.length || 0))
  const labels = Array.isArray(savedProject?.visualRefLabels)
    ? savedProject.visualRefLabels
    : []

  return {
    ...defaultProject,
    ...safeTextFields,
    visualRefs: Array.from(
      { length: refCount },
      (_, index) => {
        const reference = refs[index] ?? null
        // Blob URLs do not survive refreshes; discard stale links from older saves.
        return typeof reference === 'string' && reference.startsWith('blob:')
          ? null
          : typeof reference === 'string' && reference.startsWith('data:')
            ? reference
            : null
      },
    ),
    visualRefLabels: Array.from(
      { length: refCount },
      (_, index) => typeof labels[index] === 'string' ? labels[index].slice(0, 100) : '',
    ),
  }
}

function normalizeSavedScenes(savedScenes) {
  if (!Array.isArray(savedScenes) || savedScenes.length === 0) return null

  const usedSceneIds = new Set()
  return savedScenes.map((rawScene, sceneIndex) => {
    const sourceScene = rawScene && typeof rawScene === 'object' ? rawScene : {}
    let sceneId = typeof sourceScene.id === 'string' && sourceScene.id
      ? sourceScene.id
      : crypto.randomUUID()
    if (usedSceneIds.has(sceneId)) sceneId = crypto.randomUUID()
    usedSceneIds.add(sceneId)

    const usedShotIds = new Set()
    const rawShots = Array.isArray(sourceScene.shots) ? sourceScene.shots : []
    const shots = rawShots.map((rawShot, shotIndex) => {
      const sourceShot = rawShot && typeof rawShot === 'object' ? rawShot : {}
      let shotId = typeof sourceShot.id === 'string' && sourceShot.id
        ? sourceShot.id
        : crypto.randomUUID()
      if (usedShotIds.has(shotId)) shotId = crypto.randomUUID()
      usedShotIds.add(shotId)

      const legacyEquipment = Array.isArray(sourceShot.equipment)
        ? sourceShot.equipment
        : sourceShot.equipment
          ? [sourceShot.equipment]
          : sourceShot.support
            ? [sourceShot.support]
            : []

      const stringField = (key, maxLength = 500) => (
        typeof sourceShot[key] === 'string' ? sourceShot[key].slice(0, maxLength) : ''
      )

      return {
        ...sourceShot,
        id: shotId,
        // Shot numbers are positional; this also repairs duplicates from older versions.
        num: String(shotIndex + 1).padStart(3, '0'),
        subject: stringField('subject', 1000),
        size: stringField('size', 100),
        camera: stringField('camera', 200),
        angle: stringField('angle', 100),
        lens: stringField('lens', 100),
        movements: Array.isArray(sourceShot.movements)
          ? [...new Set(sourceShot.movements.filter(item => typeof item === 'string'))]
          : [],
        equipment: [...new Set(legacyEquipment.filter(item => typeof item === 'string'))],
        status: ['planned', 'done', 'skip'].includes(sourceShot.status) ? sourceShot.status : 'planned',
        storyboardImage: typeof sourceShot.storyboardImage === 'string'
          && sourceShot.storyboardImage.length <= 2500000
          && /^data:image\/(?:jpeg|png|webp);base64,/i.test(sourceShot.storyboardImage)
          ? sourceShot.storyboardImage
          : '',
        sound: stringField('sound', 100),
        take: stringField('take', 100),
        script: stringField('script', 100),
        setup: stringField('setup', 100),
        estShoot: stringField('estShoot', 100),
        notes: stringField('notes', 2000),
      }
    })

    return {
      ...sourceScene,
      id: sceneId,
      name: typeof sourceScene.name === 'string'
        ? sourceScene.name.slice(0, 120)
        : `Scene ${String(sceneIndex + 1).padStart(2, '0')}`,
      location: typeof sourceScene.location === 'string' ? sourceScene.location.slice(0, 300) : '',
      intExt: ['INT', 'EXT', 'INT/EXT'].includes(sourceScene.intExt) ? sourceScene.intExt : 'INT',
      dayNight: ['DAY', 'NIGHT', 'DAWN', 'DUSK'].includes(sourceScene.dayNight) ? sourceScene.dayNight : 'DAY',
      shots,
    }
  })
}

const defaultScene = (num, cameraDefault = '') => ({
  id: crypto.randomUUID(),
  name: `Scene ${String(num).padStart(2, '0')}`,
  location: '',
  intExt: 'INT',
  dayNight: 'DAY',
  shots: [defaultShot(1, cameraDefault)],
})

const defaultShot = (num, cameraDefault = '') => ({
  id: crypto.randomUUID(),
  num: String(num).padStart(3, '0'),
  subject: '',
  size: '',
  camera: cameraDefault,
  angle: '',
  lens: '',
  movements: [],
  equipment: [],
  status: 'planned',
  storyboardImage: '',
  sound: '',
  take: '',
  script: '',
  setup: '',
  estShoot: '',
  notes: '',
})

function createProjectRecord(id, project, scenes, activeSceneId, floorplans = {}, rooms = []) {
  const safeId = id || crypto.randomUUID()
  const safeTitle = project?.title?.trim() || 'Proyek tanpa judul'
  return {
    id: safeId,
    name: safeTitle,
    project,
    scenes,
    activeSceneId: activeSceneId || scenes[0]?.id || '',
    floorplans,
    rooms: Array.isArray(rooms) ? rooms : [],
    updatedAt: new Date().toISOString(),
  }
}

function upsertProject(projects, record) {
  const index = projects.findIndex(item => item.id === record.id)
  if (index < 0) return [...projects, record]
  return projects.map(item => item.id === record.id ? record : item)
}

function normalizeFloorplanCoordinate(value, max) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.min(max, number)) : 0
}

// Convert legacy rectangular Rooms in memory. Keep ceilingHeight absent for
// migrated Rooms so existing projects are never silently assigned a height.
function normalizeRoomPolygon(room, index = 0) {
  if (!room || typeof room !== 'object') return null
  const legacyRectangle = !Array.isArray(room.points) || room.points.length < 3
  const x = normalizeFloorplanCoordinate(room.x, 1000)
  const y = normalizeFloorplanCoordinate(room.y, 650)
  const width = Math.max(12, Math.min(1000, Number(room.width) || 100))
  const height = Math.max(12, Math.min(650, Number(room.height) || 80))
  const points = legacyRectangle
    ? [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
    : room.points.slice(0, 500).map(point => ({ x: Number(point.x) || 0, y: Number(point.y) || 0 }))
  const oldSideToEdge = { top: 0, right: 1, bottom: 2, left: 3 }
  const openings = (Array.isArray(room.openings) ? room.openings : []).map(opening => {
    const next = opening && typeof opening === 'object' ? { ...opening } : {}
    if (Number.isInteger(next.edgeIndex)) {
      next.edgeIndex = Math.max(0, Math.min(points.length - 1, next.edgeIndex))
    } else {
      next.edgeIndex = legacyRectangle ? (oldSideToEdge[next.side] ?? 2) : 0
    }
    next.id = typeof next.id === 'string' && next.id ? next.id : crypto.randomUUID()
    next.type = next.type === 'window' ? 'window' : 'door'
    next.offset = Math.max(0.02, Math.min(0.98, Number.isFinite(Number(next.offset)) ? Number(next.offset) : 0.5))
    // Legacy bottom and left edges run opposite to the polygon perimeter order.
    if (legacyRectangle && ['bottom', 'left'].includes(next.side)) next.offset = 1 - next.offset
    next.width = Math.max(12, Math.min(500, Number(next.width) || (next.type === 'window' ? 58 : 48)))
    delete next.side
    return next
  })
  return {
    id: typeof room.id === 'string' && room.id ? room.id : crypto.randomUUID(),
    points,
    label: typeof room.label === 'string' ? room.label : 'Room ' + String(index + 1).padStart(2, '0'),
    ...(Number.isFinite(Number(room.ceilingHeight)) && Number(room.ceilingHeight) > 0
      ? { ceilingHeight: Number(room.ceilingHeight) } : {}),
    openings,
  }
}

function normalizeSavedFloorplans(savedFloorplans, savedScenes) {
  const result = {}
  if (!Array.isArray(savedScenes)) return result
  const source = savedFloorplans && typeof savedFloorplans === 'object' ? savedFloorplans : {}

  for (const scene of savedScenes) {
    const raw = source[scene.id] && typeof source[scene.id] === 'object'
      ? source[scene.id]
      : {}
    const validShotIds = new Set((scene.shots || []).map(shot => shot.id))
    const safeId = item => typeof item?.id === 'string' && item.id ? item.id.slice(0, 100) : crypto.randomUUID()
    const safeLabel = (value, fallback) => typeof value === 'string' ? value.slice(0, 80) : fallback
    const coords = (value, max) => normalizeFloorplanCoordinate(value, max)
    const normalizeOpenings = (openings, allowSide = false) => (Array.isArray(openings) ? openings : [])
      .filter(opening => opening && typeof opening === 'object')
      .slice(0, 100)
      .map(opening => ({
        id: safeId(opening),
        type: ['window', 'doorway'].includes(opening.type) ? opening.type : 'door',
        offset: Math.max(0.02, Math.min(0.98, Number.isFinite(Number(opening.offset)) ? Number(opening.offset) : 0.5)),
        width: Math.max(12, Math.min(500, Number(opening.width) || (opening.type === 'window' ? 58 : 48))),
        ...(Number.isFinite(Number(opening.height)) && Number(opening.height) >= 0 ? { height: Math.min(400, Number(opening.height)) } : {}),
        ...(opening.type === 'doorway' ? { label: typeof opening.label === 'string' ? opening.label.slice(0, 80) : 'Pintu Tanpa Daun', swingDirection: opening.swingDirection === 'out' ? 'out' : 'in' } : {}),
        ...(opening.type === 'door' ? { swingDirection: opening.swingDirection === 'out' ? 'out' : 'in', doorType: opening.doorType === 'double' ? 'double' : 'single', hingeSide: opening.hingeSide === 'right' ? 'right' : 'left' } : {}),
        ...(allowSide ? { side: ['top', 'right', 'bottom', 'left'].includes(opening.side) ? opening.side : 'bottom' } : {}),
      }))
    const projectToSegment = (point, x1, y1, x2, y2) => {
      const dx = x2 - x1
      const dy = y2 - y1
      const lengthSquared = dx * dx + dy * dy
      const offset = lengthSquared ? Math.max(0, Math.min(1, ((point.x - x1) * dx + (point.y - y1) * dy) / lengthSquared)) : 0
      const x = x1 + dx * offset
      const y = y1 + dy * offset
      return { offset, x, y, distance: Math.hypot(point.x - x, point.y - y) }
    }

    result[scene.id] = {
      rooms: (Array.isArray(raw.rooms) ? raw.rooms : []).filter(item => item && typeof item === 'object').slice(0, 200)
        .map((item, index) => normalizeRoomPolygon(item, index)).filter(Boolean),
      walls: (Array.isArray(raw.walls) ? raw.walls : []).filter(item => item && typeof item === 'object').slice(0, 500).map(item => ({
        id: safeId(item),
        x1: coords(item.x1, 1000),
        y1: coords(item.y1, 650),
        x2: coords(item.x2, 1000),
        y2: coords(item.y2, 650),
        thickness: Math.max(2, Math.min(20, Number(item.thickness) || 6)),
        openings: normalizeOpenings(item.openings),
      })),
      doors: (Array.isArray(raw.doors) ? raw.doors : []).filter(item => item && typeof item === 'object').slice(0, 200).map((item, index) => ({
        id: safeId(item),
        x: coords(item.x, 1000),
        y: coords(item.y, 650),
        angle: coords(item.angle, 360),
        width: Math.max(12, Math.min(300, Number(item.width) || 52)),
        height: Math.max(8, Math.min(200, Number(item.height) || 12)),
        label: safeLabel(item.label, 'Door ' + String(index + 1).padStart(2, '0')),
      })),
      windows: (Array.isArray(raw.windows) ? raw.windows : []).filter(item => item && typeof item === 'object').slice(0, 200).map((item, index) => ({
        id: safeId(item),
        x: coords(item.x, 1000),
        y: coords(item.y, 650),
        angle: coords(item.angle, 360),
        width: Math.max(12, Math.min(300, Number(item.width) || 64)),
        height: Math.max(8, Math.min(200, Number(item.height) || 10)),
        label: safeLabel(item.label, 'Window ' + String(index + 1).padStart(2, '0')),
      })),
      props: (Array.isArray(raw.props) ? raw.props : []).filter(item => item && typeof item === 'object').slice(0, 300).map((item, index) => ({
        id: safeId(item),
        x: coords(item.x, 1000),
        y: coords(item.y, 650),
        angle: coords(item.angle, 360),
        width: Math.max(12, Math.min(300, Number(item.width) || 52)),
        height: Math.max(8, Math.min(200, Number(item.height) || 36)),
        propType: safeLabel(item.propType, 'Custom'),
        label: safeLabel(item.label, 'Prop ' + String(index + 1).padStart(2, '0')),
      })),
      actors: (Array.isArray(raw.actors) ? raw.actors : []).filter(item => item && typeof item === 'object').slice(0, 200).map((item, index) => ({
        id: safeId(item),
        x: coords(item.x, 1000),
        y: coords(item.y, 650),
        angle: coords(item.angle, 360),
        label: safeLabel(item.label, 'Actor ' + String(index + 1).padStart(2, '0')),
        movement: safeLabel(item.movement, 'Blocking'),
        path: (Array.isArray(item.path) ? item.path : []).slice(0, 100).map(point => ({
          x: coords(point?.x, 1000),
          y: coords(point?.y, 650),
        })),
      })),
      cameras: (Array.isArray(raw.cameras) ? raw.cameras : [])
        .filter(item => item && typeof item === 'object')
        .slice(0, 200)
        .map((item, index) => ({
          id: safeId(item),
          shotId: typeof item.shotId === 'string' && validShotIds.has(item.shotId) ? item.shotId : '',
          x: coords(item.x, 1000),
          y: coords(item.y, 650),
          angle: coords(item.angle, 360),
          label: safeLabel(item.label, 'Camera ' + String(index + 1).padStart(2, '0')),
          movement: safeLabel(item.movement, 'Static'),
          path: (Array.isArray(item.path) ? item.path : []).slice(0, 100).map(point => ({
            x: coords(point?.x, 1000),
            y: coords(point?.y, 650),
          })),
        })),
      lights: (Array.isArray(raw.lights) ? raw.lights : []).filter(item => item && typeof item === 'object').slice(0, 200).map((item, index) => ({
        id: safeId(item),
        x: coords(item.x, 1000),
        y: coords(item.y, 650),
        angle: coords(item.angle, 360),
        lightType: safeLabel(item.lightType || item.type, 'Key'),
        label: safeLabel(item.label, 'Light ' + String(index + 1)),
        movement: safeLabel(item.movement, 'Static'),
        path: (Array.isArray(item.path) ? item.path : []).slice(0, 100).map(point => ({
          x: coords(point?.x, 1000),
          y: coords(point?.y, 650),
        })),
      })),
    }

    // Migrate old standalone door/window markers to openings on the nearest room edge or wall.
    const normalized = result[scene.id]
    const legacyOpenings = [
      ...(Array.isArray(raw.doors) ? raw.doors : []).filter(item => item && typeof item === 'object').map(item => ({
        id: safeId(item), type: 'door', x: coords(item.x, 1000), y: coords(item.y, 650),
        angle: coords(item.angle, 360), width: Math.max(12, Math.min(300, Number(item.width) || 52)),
      })),
      ...(Array.isArray(raw.windows) ? raw.windows : []).filter(item => item && typeof item === 'object').map(item => ({
        id: safeId(item), type: 'window', x: coords(item.x, 1000), y: coords(item.y, 650),
        angle: coords(item.angle, 360), width: Math.max(12, Math.min(300, Number(item.width) || 58)),
      })),
    ]
    delete normalized.doors
    delete normalized.windows

    for (const opening of legacyOpenings) {
      const point = { x: opening.x, y: opening.y }
      let best = null
      for (const wall of normalized.walls) {
        const projection = projectToSegment(point, wall.x1, wall.y1, wall.x2, wall.y2)
        if (!best || projection.distance < best.distance) {
          best = { kind: 'wall', id: wall.id, offset: projection.offset, distance: projection.distance }
        }
      }
      for (const room of normalized.rooms) {
        const edges = [
          { side: 'top', x1: room.x, y1: room.y, x2: room.x + room.width, y2: room.y },
          { side: 'right', x1: room.x + room.width, y1: room.y, x2: room.x + room.width, y2: room.y + room.height },
          { side: 'bottom', x1: room.x, y1: room.y + room.height, x2: room.x + room.width, y2: room.y + room.height },
          { side: 'left', x1: room.x, y1: room.y, x2: room.x, y2: room.y + room.height },
        ]
        for (const edge of edges) {
          const projection = projectToSegment(point, edge.x1, edge.y1, edge.x2, edge.y2)
          if (!best || projection.distance < best.distance) {
            best = { kind: 'room', id: room.id, side: edge.side, offset: projection.offset, distance: projection.distance }
          }
        }
      }
      const embedded = { id: opening.id, type: opening.type, offset: best ? best.offset : 0.5, width: opening.width }
      if (best?.kind === 'room') {
        const room = normalized.rooms.find(item => item.id === best.id)
        room.openings = [...(room.openings || []), { ...embedded, side: best.side }]
      } else if (best?.kind === 'wall') {
        const wall = normalized.walls.find(item => item.id === best.id)
        wall.openings = [...(wall.openings || []), embedded]
      } else {
        const angle = (opening.angle || 0) * Math.PI / 180
        const halfLength = Math.max(70, opening.width)
        const wall = {
          id: crypto.randomUUID(),
          x1: coords(point.x - Math.cos(angle) * halfLength, 1000),
          y1: coords(point.y - Math.sin(angle) * halfLength, 650),
          x2: coords(point.x + Math.cos(angle) * halfLength, 1000),
          y2: coords(point.y + Math.sin(angle) * halfLength, 650),
          thickness: 6,
          openings: [{ ...embedded, offset: 0.5 }],
        }
        normalized.walls.push(wall)
      }
    }
  }
  return result
}

function migrateReusableRooms(savedScenes, savedFloorplans, savedRooms = []) {
  const scenes = (savedScenes || []).map(scene => ({ ...scene, roomIds: Array.isArray(scene.roomIds) ? [...scene.roomIds] : [] }))
  const floorplans = normalizeSavedFloorplans(savedFloorplans, scenes)
  const rooms = Array.isArray(savedRooms)
    ? savedRooms.map((room, index) => normalizeRoomPolygon(room, index)).filter(Boolean)
    : []
  const knownIds = new Set(rooms.map(room => room.id))
  for (const scene of scenes) {
    const layout = floorplans[scene.id] || { rooms: [] }
    const legacyRooms = Array.isArray(layout.rooms) ? layout.rooms : []
    scene.roomIds = scene.roomIds.filter(id => knownIds.has(id))
    for (const sourceRoom of legacyRooms) {
      // If the scene already references this exact Room ID, its geometry is already canonical.
      if (scene.roomIds.includes(sourceRoom.id) && knownIds.has(sourceRoom.id)) continue
      let room = { ...sourceRoom }
      if (knownIds.has(room.id)) {
        // Legacy IDs can collide across scenes. Preserve both rooms without merging geometry.
        room.id = crypto.randomUUID()
      }
      knownIds.add(room.id)
      rooms.push(room)
      scene.roomIds.push(room.id)
    }
    floorplans[scene.id] = { ...layout, rooms: [] }
  }
  return { scenes, floorplans, rooms }
}

function normalizeWorkspaceProjects(savedProjects) {
  if (!Array.isArray(savedProjects)) return []

  const seen = new Set()
  return savedProjects
    .filter(item => item && typeof item.id === 'string' && item.project && !seen.has(item.id) && seen.add(item.id))
    .map(item => {
      const normalizedProject = normalizeSavedProject(item.project)
      const normalizedScenes = normalizeSavedScenes(item.scenes) || [defaultScene(1)]
      const migrated = migrateReusableRooms(normalizedScenes, item.floorplans, item.rooms)
      return {
        ...createProjectRecord(
          item.id,
          normalizedProject,
          migrated.scenes,
          item.activeSceneId || migrated.scenes[0]?.id || '',
          migrated.floorplans,
          migrated.rooms,
        ),
        name: normalizedProject.title?.trim() || item.name || 'Proyek tanpa judul',
        updatedAt: item.updatedAt || new Date().toISOString(),
      }
    })
}

export default function App() {
  const [theme, setTheme] = useState(() => {
    try {
      return window.localStorage.getItem('cineblock.ui-theme') === 'light' ? 'light' : 'dark'
    } catch {
      return 'dark'
    }
  })
  const [tab, setTab] = useState('floorplan')
  const [project, setProject] = useState(defaultProject)
  const [scenes, setScenes] = useState(() => [defaultScene(1)])
  const [activeSceneId, setActiveSceneId] = useState('')
  const [selectedShotId, setSelectedShotId] = useState('')
  const [floorplans, setFloorplans] = useState({})
  const [projectRooms, setProjectRooms] = useState(null)
  const [projects, setProjects] = useState([])
  const [activeProjectId, setActiveProjectId] = useState('')
  const [hydrated, setHydrated] = useState(false)
  const [saveStatus, setSaveStatus] = useState('loading')
  const [externalSaveDetected, setExternalSaveDetected] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exportMode, setExportMode] = useState('shotlist-table')
  const [exportOrientation, setExportOrientation] = useState('landscape')
  const [printRequest, setPrintRequest] = useState(false)
  const printStartedRef = useRef(false)
  const saveRevisionRef = useRef(0)
  const externalSaveDetectedRef = useRef(false)
  const backupInputRef = useRef(null)
  const [syncDialogOpen, setSyncDialogOpen] = useState(false)
  const [cloudStatus, setCloudStatus] = useState('local')
  const [cloudRole, setCloudRole] = useState('')
  const [cloudProjectId, setCloudProjectId] = useState('')
  const [cloudRevision, setCloudRevision] = useState(0)
  const [cloudError, setCloudError] = useState('')
  const [shareUrl, setShareUrl] = useState('')
  const [shareLinkToOpen, setShareLinkToOpen] = useState('')
  const [displayName, setDisplayName] = useState(() => getSavedDisplayName())
  const [cloudConflict, setCloudConflict] = useState(null)
  const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine)
  const cloudProjectRef = useRef(null)
  const cloudRevisionRef = useRef(0)
  const cloudDirtyRef = useRef(false)
  const skipCloudSaveRef = useRef(false)
  const cloudLinkHandledRef = useRef(false)
  const cloudConflictRef = useRef(null)
  const cloudLatestSnapshotRef = useRef(null)
  const saveCloudProjectWithEchoGuard = async (projectId, payload, expectedRevision) => {
    const result = await saveCloudProject(projectId, payload, expectedRevision)
    // Supabase Realtime can deliver our own UPDATE before the save promise
    // resolves. Advance the known revision immediately so that echo is not
    // mistaken for a competing edit while the autosave effect is still dirty.
    if (result?.ok && result.project?.id === projectId) {
      const nextRevision = Number(result.project.revision) || 0
      if (cloudProjectId === projectId || cloudProjectRef.current?.id === projectId) {
        cloudRevisionRef.current = Math.max(cloudRevisionRef.current, nextRevision)
      }
    }
    return result
  }

  const applyCloudRecord = (remote, role, replaceCurrentProject = false) => {
    const payload = remote?.payload && typeof remote.payload === 'object' ? remote.payload : {}
    const rawRecord = {
      ...payload,
      id: remote.id,
      name: remote.name || payload.name || payload.project?.title || 'Proyek tanpa judul',
      updatedAt: remote.updated_at || payload.updatedAt || new Date().toISOString(),
    }
    const remoteScenes = normalizeSavedScenes(rawRecord.scenes) || [defaultScene(1)]
    const migrated = migrateReusableRooms(remoteScenes, rawRecord.floorplans, rawRecord.rooms)
    const nextActiveSceneId = migrated.scenes.some(scene => scene.id === rawRecord.activeSceneId)
      ? rawRecord.activeSceneId
      : migrated.scenes[0]?.id || ''
    const normalizedRecord = {
      ...rawRecord,
      scenes: migrated.scenes,
      floorplans: migrated.floorplans,
      rooms: migrated.rooms,
      activeSceneId: nextActiveSceneId,
    }

    skipCloudSaveRef.current = true
    cloudDirtyRef.current = false
    cloudConflictRef.current = null
    setCloudConflict(null)
    cloudRevisionRef.current = Number(remote.revision) || 1
    cloudProjectRef.current = { id: remote.id, role, revision: cloudRevisionRef.current, pending: false }
    const map = readCloudProjectMap()
    map[remote.id] = { id: remote.id, role, revision: cloudRevisionRef.current, pending: false }
    writeCloudProjectMap(map)
    setCloudProjectId(remote.id)
    setCloudRole(role)
    setCloudRevision(cloudRevisionRef.current)
    setCloudStatus('synced')
    setCloudError('')
    setProjects(previous => {
      const base = replaceCurrentProject
        ? previous.filter(item => item.id !== activeProjectId || item.id === remote.id)
        : previous
      return upsertProject(base, normalizedRecord)
    })
    setActiveProjectId(remote.id)
    setProject(normalizeSavedProject(normalizedRecord.project))
    setScenes(normalizedRecord.scenes)
    setActiveSceneId(nextActiveSceneId)
    setFloorplans(migrated.floorplans)
    setProjectRooms(migrated.rooms)
    setTab('floorplan')
  }

  useEffect(() => {
    const updateOnlineStatus = () => setIsOnline(navigator.onLine)
    window.addEventListener('online', updateOnlineStatus)
    window.addEventListener('offline', updateOnlineStatus)
    return () => {
      window.removeEventListener('online', updateOnlineStatus)
      window.removeEventListener('offline', updateOnlineStatus)
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      window.localStorage.setItem('cineblock.ui-theme', theme)
    } catch {
      // Theme remains active for this session when browser storage is unavailable.
    }
  }, [theme])

  const changeActiveScene = sceneId => {
    if (sceneId !== activeSceneId) setSelectedShotId('')
    setActiveSceneId(sceneId)
  }

  const addScene = () => {
    const usedNumbers = new Set(
      scenes.map(scene => Number(scene.name.match(/^Scene\s+(\d+)$/i)?.[1])).filter(Number.isFinite),
    )
    let nextNumber = 1
    while (usedNumbers.has(nextNumber)) nextNumber += 1
    const newScene = defaultScene(nextNumber, project.camera)
    setScenes(previous => [...previous, newScene])
    setActiveSceneId(newScene.id)
    setSelectedShotId('')
  }

  const renameScene = (sceneId, name) => {
    const nextName = name.trim().slice(0, 120)
    if (!nextName) return
    setScenes(previous => previous.map(scene => scene.id === sceneId ? { ...scene, name: nextName } : scene))
  }

  useEffect(() => {
    if (!printRequest) {
      printStartedRef.current = false
      return
    }
    if (printStartedRef.current) return
    printStartedRef.current = true

    let pageStyle = document.getElementById('cineblock-print-page-settings')
    if (!pageStyle) {
      pageStyle = document.createElement('style')
      pageStyle.id = 'cineblock-print-page-settings'
      document.head.appendChild(pageStyle)
    }
    pageStyle.textContent = `@page { size: A4 ${exportOrientation}; margin: 12mm; }\n@media print { html, body, #root, .app, .print-report { box-sizing: border-box !important; max-width: 100% !important; } }`

    window.print()
    setPrintRequest(false)
  }, [printRequest, exportOrientation])

  useEffect(() => {
    let cancelled = false

    loadAppState()
      .then(savedState => {
        if (cancelled) return

        const restoredProject = normalizeSavedProject(savedState?.project)
        const legacyScenes = normalizeSavedScenes(savedState?.scenes) || scenes
        let restoredProjects = normalizeWorkspaceProjects(savedState?.projects)
        const restoredProjectId = savedState?.activeProjectId || restoredProjects[0]?.id || crypto.randomUUID()
        const savedProjectRecord = restoredProjects.find(item => item.id === restoredProjectId)
        const sourceFloorplans = savedState?.floorplans ?? savedProjectRecord?.floorplans
        const sourceRooms = Array.isArray(savedState?.rooms)
          ? savedState.rooms
          : (savedProjectRecord?.rooms || [])
        const migratedCurrent = migrateReusableRooms(
          legacyScenes,
          sourceFloorplans,
          sourceRooms,
        )
        const restoredScenes = migratedCurrent.scenes
        const restoredFloorplans = migratedCurrent.floorplans
        const restoredRooms = migratedCurrent.rooms
        const restoredActiveSceneId = restoredScenes.some(scene => scene.id === savedState?.activeSceneId)
          ? savedState.activeSceneId
          : restoredScenes[0]?.id || ''

        // Migrate the original single-project save into the project library.
        restoredProjects = upsertProject(
          restoredProjects,
          createProjectRecord(
            restoredProjectId,
            restoredProject,
            restoredScenes,
            restoredActiveSceneId,
            restoredFloorplans,
            restoredRooms,
          ),
        )

        if (savedState?.tab === 'shotlist' || savedState?.tab === 'project' || savedState?.tab === 'floorplan') {
          setTab(savedState.tab)
        }

        setProject(restoredProject)
        setScenes(restoredScenes)
        setActiveSceneId(restoredActiveSceneId)
        setFloorplans(restoredFloorplans)
        setProjectRooms(restoredRooms)
        setProjects(restoredProjects)
        setActiveProjectId(restoredProjectId)
        const query = new URLSearchParams(window.location.search)
        const hasIncomingCloudLink = query.has('share') || query.has('owner')
        const savedCloudInfo = readCloudProjectMap()[restoredProjectId]
        if (!hasIncomingCloudLink && savedCloudInfo && !savedCloudInfo.pending) {
          skipCloudSaveRef.current = true
          cloudProjectRef.current = savedCloudInfo
          cloudRevisionRef.current = Number(savedCloudInfo.revision) || 0
        }
        setSaveStatus('saved')
        setHydrated(true)
      })
      .catch(error => {
        console.error('CINEBLOCK could not restore local data:', error)
        if (!cancelled) {
          setSaveStatus('error')
          setHydrated(true)
        }
      })

    return () => {
      cancelled = true
    }
  // Initial scene state is deliberately used when no saved project exists.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!hydrated) return undefined

    return subscribeToExternalSave(() => {
      externalSaveDetectedRef.current = true
      setExternalSaveDetected(true)
      setSaveStatus('conflict')
    })
  }, [hydrated])

  useEffect(() => {
    if (!hydrated || !activeProjectId || externalSaveDetectedRef.current) return undefined

    const revision = ++saveRevisionRef.current
    const skipCloudSave = skipCloudSaveRef.current
    if (skipCloudSave) {
      skipCloudSaveRef.current = false
      cloudDirtyRef.current = false
    } else if (cloudProjectRef.current?.id === activeProjectId && cloudProjectRef.current.role !== 'viewer') {
      cloudDirtyRef.current = true
      const map = readCloudProjectMap()
      map[activeProjectId] = { ...cloudProjectRef.current, pending: true }
      cloudProjectRef.current = map[activeProjectId]
      writeCloudProjectMap(map)
    }
    setSaveStatus('saving')
    const timeout = window.setTimeout(async () => {
      if (externalSaveDetectedRef.current) return
      try {
        const currentRecord = createProjectRecord(activeProjectId, project, scenes, activeSceneId, floorplans, projectRooms || [])
        const savedProjects = upsertProject(projects, currentRecord)
        cloudLatestSnapshotRef.current = currentRecord
        await saveAppState({
          tab,
          project,
          scenes,
          activeSceneId,
          floorplans,
          rooms: projectRooms || [],
          projects: savedProjects,
          activeProjectId,
        })

        const cloudInfo = cloudProjectRef.current
        if (!skipCloudSave && cloudInfo?.id === activeProjectId && cloudInfo.role !== 'viewer' && !cloudConflictRef.current) {
          if (!isOnline) {
            setCloudStatus('offline')
          } else {
            setCloudStatus('syncing')
            try {
              const result = await saveCloudProjectWithEchoGuard(activeProjectId, { ...currentRecord, id: activeProjectId }, cloudRevisionRef.current)
              if (result.conflict) {
                cloudConflictRef.current = result.project
                setCloudConflict(result.project)
                setCloudStatus('conflict')
              } else {
                cloudRevisionRef.current = result.project.revision
                cloudProjectRef.current = { ...cloudInfo, revision: result.project.revision, pending: false }
                const map = readCloudProjectMap()
                map[activeProjectId] = cloudProjectRef.current
                writeCloudProjectMap(map)
                cloudDirtyRef.current = false
                cloudConflictRef.current = null
                setCloudConflict(null)
                setCloudRevision(result.project.revision)
                setCloudStatus('synced')
              }
            } catch (cloudSaveError) {
              console.warn('CINEBLOCK cloud save deferred; local copy is safe:', cloudSaveError)
              setCloudStatus(navigator.onLine ? 'error' : 'offline')
            }
          }
        }
        if (revision === saveRevisionRef.current) setSaveStatus('saved')
      } catch (error) {
        console.error('CINEBLOCK could not save data:', error)
        if (revision === saveRevisionRef.current) setSaveStatus('error')
      }
    }, 250)

    return () => window.clearTimeout(timeout)
  }, [hydrated, tab, project, scenes, activeSceneId, floorplans, projectRooms, projects, activeProjectId, isOnline])

  useEffect(() => {
    if (!hydrated || !isCloudSyncConfigured()) return undefined
    const params = new URLSearchParams(window.location.search)
    const token = params.get('owner') || params.get('share')
    if (!token || cloudLinkHandledRef.current) return undefined
    cloudLinkHandledRef.current = true
    const linkKind = params.has('owner') ? 'owner' : 'share'
    let cancelled = false

    const connectFromLink = async () => {
      setCloudStatus('connecting')
      setCloudError('')
      const session = await ensureCloudSession(displayName)
      if (cancelled) return
      setDisplayName(session.displayName)
      const access = await redeemCloudLink(token)
      if (cancelled) return
      const url = new URL(window.location.href)
      url.searchParams.delete('owner')
      url.searchParams.delete('share')
      window.history.replaceState({}, document.title, url.pathname + url.search + url.hash)

      let remote = await fetchCloudProject(access.id)
      const bootstrapEmptyProject = isEmptyCloudPayload(remote.payload)
      if (bootstrapEmptyProject && linkKind === 'owner') {
        const localRecord = createProjectRecord(activeProjectId, project, scenes, activeSceneId, floorplans, projectRooms || [])
        const payload = { ...localRecord, id: remote.id, name: remote.name || localRecord.name }
        const saved = await saveCloudProjectWithEchoGuard(remote.id, payload, remote.revision)
        if (saved.conflict) {
          remote = saved.project
          setCloudError('Proyek cloud berubah saat aktivasi. Versi cloud tidak ditimpa; periksa konflik sebelum melanjutkan.')
          cloudConflictRef.current = remote
          setCloudConflict(remote)
          setCloudStatus('conflict')
          return
        }
        remote = saved.project
      } else if (isEmptyCloudPayload(remote.payload)) {
        throw new Error('Proyek cloud belum memiliki data. Minta pemilik menyelesaikan sinkronisasi awal terlebih dahulu.')
      } else if (linkKind === 'owner') {
        const useRemote = window.confirm('Proyek cloud ini sudah berisi data. Muat versi cloud? Versi lokal tetap disimpan sebagai proyek terpisah.')
        if (!useRemote) {
          setCloudError('Akses pemilik berhasil diaktifkan. Proyek lokal belum dihubungkan; buka Sinkronisasi untuk mengunggahnya sebagai proyek baru.')
          setCloudStatus('error')
          return
        }
      }

      if (cancelled) return
      applyCloudRecord(remote, access.role, linkKind === 'owner' && bootstrapEmptyProject)
      setSyncDialogOpen(false)
    }

    connectFromLink().catch(error => {
      if (cancelled) return
      console.error('CINEBLOCK could not connect using a share link:', error)
      setCloudError(error.message || 'Tautan sinkronisasi gagal dibuka.')
      setCloudStatus('error')
      setSyncDialogOpen(true)
    })

    return () => { cancelled = true }
  // Incoming links are processed once after the local workspace has been restored.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated])

  useEffect(() => {
    if (!hydrated || !isCloudSyncConfigured()) return undefined
    const info = readCloudProjectMap()[activeProjectId]
    if (!info?.id) {
      cloudProjectRef.current = null
      cloudDirtyRef.current = false
      setCloudProjectId('')
      setCloudRole('')
      setCloudRevision(0)
      if (!cloudLinkHandledRef.current || cloudStatus !== 'error') setCloudStatus('local')
      return undefined
    }
    cloudProjectRef.current = info
    cloudRevisionRef.current = Number(info.revision) || 1
    cloudDirtyRef.current = Boolean(info.pending)
    setCloudProjectId(info.id)
    setCloudRole(info.role || 'editor')
    setCloudRevision(cloudRevisionRef.current)
    if (info.pending) setCloudStatus(isOnline ? 'syncing' : 'offline')
    else setCloudStatus(isOnline ? 'synced' : 'offline')
    return undefined
  // The mapping is per-project; switching projects swaps the active cloud target.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, activeProjectId])

  useEffect(() => {
    if (!hydrated || !cloudProjectId || !isCloudSyncConfigured()) return undefined
    let cancelled = false
    const handleRemoteUpdate = remote => {
      if (cancelled || !remote || Number(remote.revision) <= cloudRevisionRef.current) return
      const localMapEntry = readCloudProjectMap()[remote.id]
      if (cloudDirtyRef.current || localMapEntry?.pending) {
        cloudConflictRef.current = remote
        setCloudConflict(remote)
        setCloudStatus('conflict')
        return
      }
      applyCloudRecord(remote, cloudProjectRef.current?.role || cloudRole, false)
    }
    const unsubscribe = subscribeToCloudProject(cloudProjectId, handleRemoteUpdate, status => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setCloudStatus(navigator.onLine ? 'error' : 'offline')
      }
    })
    fetchCloudProject(cloudProjectId).then(remote => {
      if (cancelled) return
      const localMapEntry = readCloudProjectMap()[remote.id]
      if (Number(remote.revision) > cloudRevisionRef.current) {
        if (cloudDirtyRef.current || localMapEntry?.pending) {
          cloudConflictRef.current = remote
          setCloudConflict(remote)
          setCloudStatus('conflict')
        } else {
          applyCloudRecord(remote, cloudProjectRef.current?.role || cloudRole, false)
        }
      } else if (localMapEntry?.pending && isOnline && !cloudConflictRef.current) {
        const snapshot = cloudLatestSnapshotRef.current || createProjectRecord(activeProjectId, project, scenes, activeSceneId, floorplans, projectRooms || [])
        saveCloudProjectWithEchoGuard(remote.id, { ...snapshot, id: remote.id }, remote.revision).then(result => {
          if (cancelled) return
          if (result.conflict) {
            cloudConflictRef.current = result.project
            setCloudConflict(result.project)
            setCloudStatus('conflict')
          } else {
            cloudRevisionRef.current = result.project.revision
            cloudProjectRef.current = { ...localMapEntry, revision: result.project.revision, pending: false }
            const map = readCloudProjectMap()
            map[remote.id] = cloudProjectRef.current
            writeCloudProjectMap(map)
            cloudDirtyRef.current = false
            setCloudRevision(result.project.revision)
            setCloudStatus('synced')
          }
        }).catch(error => {
          console.warn('CINEBLOCK pending cloud save remains queued:', error)
          setCloudStatus(navigator.onLine ? 'error' : 'offline')
        })
      }
    }).catch(error => {
      if (!cancelled) {
        console.warn('CINEBLOCK could not refresh cloud project:', error)
        setCloudStatus(navigator.onLine ? 'error' : 'offline')
      }
    })

    // Realtime is the fast path, but some browsers/networks can silently drop
    // websocket events. Poll the same cloud project as a recovery path so all
    // devices eventually receive the newest revision without requiring refresh.
    let pollInFlight = false
    const pollTimer = window.setInterval(async () => {
      if (cancelled || pollInFlight || !navigator.onLine) return
      pollInFlight = true
      try {
        const remote = await fetchCloudProject(cloudProjectId)
        if (!cancelled) handleRemoteUpdate(remote)
      } catch (error) {
        if (!cancelled) console.warn('CINEBLOCK cloud polling retry failed:', error)
      } finally {
        pollInFlight = false
      }
    }, 2500)

    return () => {
      cancelled = true
      window.clearInterval(pollTimer)
      unsubscribe?.()
    }
  // Cloud changes are scoped to the active project; CAS revision checks protect concurrent edits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, cloudProjectId, cloudRole])

  const snapshotCurrentProject = () => (
    createProjectRecord(activeProjectId, project, scenes, activeSceneId, floorplans, projectRooms || [])
  )

  const resolvedFloorplans = projectRooms === null
    ? floorplans
    : Object.fromEntries(scenes.map(scene => [
      scene.id,
      {
        ...(floorplans?.[scene.id] || {}),
        rooms: (projectRooms || []).filter(room => (scene.roomIds || []).includes(room.id)),
      },
    ]))

  const switchProject = (projectId) => {
    if (!projectId || projectId === activeProjectId) return
    const target = projects.find(item => item.id === projectId)
    if (!target) return

    setProjects(previous => upsertProject(previous, snapshotCurrentProject()))
    const targetScenes = normalizeSavedScenes(target.scenes) || [defaultScene(1)]
    const targetActiveSceneId = targetScenes.some(scene => scene.id === target.activeSceneId)
      ? target.activeSceneId
      : targetScenes[0]?.id || ''
    const migratedTarget = migrateReusableRooms(targetScenes, target.floorplans, target.rooms)
    const targetScenesWithRooms = migratedTarget.scenes
    const targetFloorplans = migratedTarget.floorplans
    setActiveProjectId(target.id)
    setProject(normalizeSavedProject(target.project))
    setScenes(targetScenesWithRooms)
    setActiveSceneId(targetActiveSceneId)
    setFloorplans(targetFloorplans)
    setProjectRooms(migratedTarget.rooms)
    setTab('floorplan')
  }

  const handleOpenExistingCloudLink = () => {
    setCloudError('')
    try {
      const pasted = shareLinkToOpen.trim()
      if (!pasted) throw new Error('Tempel tautan editor NEPTU terlebih dahulu.')
      const parsed = new URL(pasted)
      const token = parsed.searchParams.get('share')
      if (!token) throw new Error('Tautan tidak memiliki token editor. Gunakan tautan yang dibuat melalui tombol “Buat tautan editor”.')
      const destination = new URL(window.location.origin)
      destination.searchParams.set('share', token)
      window.location.assign(destination.toString())
    } catch (error) {
      setCloudError(error instanceof TypeError
        ? 'Format tautan tidak valid. Tempel seluruh tautan editor, termasuk bagian ?share=… .'
        : error.message || 'Tautan editor tidak dapat dibuka.')
    }
  }

  const handleConnectCloud = async () => {
    if (!isCloudSyncConfigured()) {
      setCloudError('Sinkronisasi cloud belum dikonfigurasi.')
      return
    }
    setCloudStatus('connecting')
    setCloudError('')
    try {
      const session = await ensureCloudSession(displayName)
      setDisplayName(session.displayName)
      const localRecord = snapshotCurrentProject()
      const bootstrapToken = new URLSearchParams(window.location.search).get('owner_bootstrap') || ''
      const created = await createCloudProject(localRecord.name, localRecord, bootstrapToken)
      const cloudPayload = { ...localRecord, id: created.id, name: created.name || localRecord.name }
      const saved = await saveCloudProjectWithEchoGuard(created.id, cloudPayload, Number(created.revision) || 1)
      if (saved.conflict) {
        cloudConflictRef.current = saved.project
        setCloudConflict(saved.project)
        setCloudStatus('conflict')
        throw new Error('Proyek cloud berubah saat dibuat. Periksa konflik sebelum melanjutkan.')
      }
      const syncedRecord = { ...cloudPayload, updatedAt: saved.project.updated_at }
      const map = readCloudProjectMap()
      map[created.id] = { id: created.id, role: 'owner', revision: saved.project.revision, pending: false }
      writeCloudProjectMap(map)
      cloudProjectRef.current = map[created.id]
      cloudRevisionRef.current = saved.project.revision
      cloudDirtyRef.current = false
      skipCloudSaveRef.current = true
      setProjects(previous => upsertProject(previous.filter(item => item.id !== activeProjectId), syncedRecord))
      setActiveProjectId(created.id)
      setCloudProjectId(created.id)
      setCloudRole('owner')
      setCloudRevision(saved.project.revision)
      setCloudStatus('synced')
      setCloudError('')
      setShareUrl('')
      if (bootstrapToken) {
        const cleanUrl = new URL(window.location.href)
        cleanUrl.searchParams.delete('owner_bootstrap')
        window.history.replaceState({}, '', cleanUrl.toString())
      }
    } catch (error) {
      console.error('CINEBLOCK could not connect project to cloud:', error)
      setCloudError(error.message || 'Proyek gagal dihubungkan ke cloud.')
      if (navigator.onLine) setCloudStatus('error')
      else setCloudStatus('offline')
    }
  }

  const handleCreateShareLink = async () => {
    if (!cloudProjectId || cloudRole !== 'owner') return
    setCloudError('')
    try {
      const session = await ensureCloudSession(displayName)
      setDisplayName(session.displayName)
      const link = await createCloudShareLink(cloudProjectId, 'editor')
      const generatedShareAddress = new URL(link.url)
      const shareAddress = new URL(window.location.origin)
      shareAddress.pathname = generatedShareAddress.pathname
      shareAddress.search = generatedShareAddress.search
      shareAddress.hash = generatedShareAddress.hash
      setShareUrl(shareAddress.toString())
    } catch (error) {
      setCloudError(error.message || 'Tautan berbagi gagal dibuat.')
    }
  }

  const handleCopyShareLink = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCloudError('')
      window.alert('Tautan berhasil disalin. Kirim tautan ini ke HP untuk membuka proyek yang sama.')
    } catch {
      setCloudError('Salin tautan secara manual dari kolom tautan berbagi.')
    }
  }

  const handleRetryCloudSync = async () => {
    if (!cloudProjectId || cloudRole === 'viewer') return
    setCloudStatus('syncing')
    setCloudError('')
    try {
      const latest = await fetchCloudProject(cloudProjectId)
      const mapEntry = readCloudProjectMap()[cloudProjectId]
      if (latest.revision > cloudRevisionRef.current && (cloudDirtyRef.current || mapEntry?.pending)) {
        cloudConflictRef.current = latest
        setCloudConflict(latest)
        setCloudStatus('conflict')
        return
      }
      if (latest.revision > cloudRevisionRef.current) {
        applyCloudRecord(latest, cloudRole || 'editor', false)
        return
      }
      const snapshot = { ...snapshotCurrentProject(), id: cloudProjectId }
      const result = await saveCloudProjectWithEchoGuard(cloudProjectId, snapshot, latest.revision)
      if (result.conflict) {
        cloudConflictRef.current = result.project
        setCloudConflict(result.project)
        setCloudStatus('conflict')
        return
      }
      const nextMap = readCloudProjectMap()
      nextMap[cloudProjectId] = { id: cloudProjectId, role: cloudRole || 'editor', revision: result.project.revision, pending: false }
      writeCloudProjectMap(nextMap)
      cloudProjectRef.current = nextMap[cloudProjectId]
      cloudRevisionRef.current = result.project.revision
      cloudDirtyRef.current = false
      cloudConflictRef.current = null
      setCloudConflict(null)
      setCloudRevision(result.project.revision)
      setCloudStatus('synced')
    } catch (error) {
      setCloudError(error.message || 'Sinkronisasi ulang gagal.')
      setCloudStatus(navigator.onLine ? 'error' : 'offline')
    }
  }

  const handleLoadRemoteConflict = () => {
    const remote = cloudConflictRef.current
    if (!remote) return
    if (!window.confirm('Muat versi cloud? Versi lokal yang belum tersinkron akan disimpan sebagai salinan lokal terpisah.')) return
    const localRecord = snapshotCurrentProject()
    const localCopy = {
      ...localRecord,
      id: crypto.randomUUID(),
      name: ((localRecord.name || 'Proyek tanpa judul') + ' (versi lokal konflik)').slice(0, 200),
      updatedAt: new Date().toISOString(),
    }
    setProjects(previous => upsertProject(previous, localCopy))
    applyCloudRecord(remote, cloudRole || cloudProjectRef.current?.role || 'editor', false)
  }

  const handleOverwriteRemoteConflict = async () => {
    if (!cloudConflictRef.current || !activeProjectId) return
    if (!window.confirm('Timpa versi cloud dengan versi perangkat ini? Perubahan cloud saat ini akan digantikan.')) return
    setCloudStatus('syncing')
    setCloudError('')
    try {
      const latest = await fetchCloudProject(activeProjectId)
      const currentRecord = { ...snapshotCurrentProject(), id: activeProjectId }
      const result = await saveCloudProjectWithEchoGuard(activeProjectId, currentRecord, latest.revision)
      if (result.conflict) {
        cloudConflictRef.current = result.project
        setCloudConflict(result.project)
        setCloudStatus('conflict')
        return
      }
      const map = readCloudProjectMap()
      map[activeProjectId] = { id: activeProjectId, role: cloudRole || 'editor', revision: result.project.revision, pending: false }
      writeCloudProjectMap(map)
      cloudProjectRef.current = map[activeProjectId]
      cloudRevisionRef.current = result.project.revision
      cloudDirtyRef.current = false
      cloudConflictRef.current = null
      setCloudConflict(null)
      setCloudRevision(result.project.revision)
      setCloudStatus('synced')
    } catch (error) {
      setCloudError(error.message || 'Versi perangkat gagal dikirim.')
      setCloudStatus(navigator.onLine ? 'error' : 'offline')
    }
  }

  const createNewProject = () => {
    const currentRecord = snapshotCurrentProject()
    const newProject = { ...defaultProject, visualRefs: [...defaultProject.visualRefs] }
    const newScenes = [defaultScene(1)]
    const newFloorplans = normalizeSavedFloorplans({}, newScenes)
    const newRecord = createProjectRecord(crypto.randomUUID(), newProject, newScenes, newScenes[0].id, newFloorplans, [])

    setProjects(previous => [...upsertProject(previous, currentRecord), newRecord])
    setActiveProjectId(newRecord.id)
    setProject(newProject)
    setScenes(newScenes)
    setActiveSceneId(newScenes[0].id)
    setFloorplans(newFloorplans)
    setProjectRooms([])
    setTab('floorplan')
  }

  const deleteCurrentProject = () => {
    if (projects.length <= 1) {
      window.alert('CINEBLOCK harus memiliki minimal satu proyek. Buat proyek lain sebelum menghapus proyek ini.')
      return
    }
    if (!window.confirm('Hapus proyek ini beserta semua scene dan shot-nya dari browser ini? Tindakan ini tidak dapat dibatalkan.')) return

    const remaining = projects.filter(item => item.id !== activeProjectId)
    const target = remaining[0]
    const targetScenes = normalizeSavedScenes(target.scenes) || [defaultScene(1)]
    const targetActiveSceneId = targetScenes.some(scene => scene.id === target.activeSceneId)
      ? target.activeSceneId
      : targetScenes[0]?.id || ''
    const migratedTarget = migrateReusableRooms(targetScenes, target.floorplans, target.rooms)
    setProjects(remaining)
    setActiveProjectId(target.id)
    setProject(normalizeSavedProject(target.project))
    setScenes(migratedTarget.scenes)
    setActiveSceneId(targetActiveSceneId)
    setFloorplans(migratedTarget.floorplans)
    setProjectRooms(migratedTarget.rooms)
    setTab('floorplan')
  }

  const downloadBackup = () => {
    const savedProjects = upsertProject(projects, snapshotCurrentProject())
    const backup = {
      app: 'CINEBLOCK',
      version: 1,
      exportedAt: new Date().toISOString(),
      activeProjectId,
      projects: savedProjects,
    }
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `cineblock-backup-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
  }

  const importBackup = async (event) => {
    const input = event.target
    const file = input.files?.[0]
    if (!file) return

    try {
      if (file.size > MAX_BACKUP_FILE_SIZE_BYTES) {
        throw new Error('Ukuran file backup maksimal 10 MB.')
      }
      const parsed = JSON.parse(await file.text())
      if (parsed?.app !== 'CINEBLOCK' || !Array.isArray(parsed.projects)) {
        throw new Error('File ini bukan backup CINEBLOCK yang valid.')
      }
      const importedProjects = normalizeWorkspaceProjects(parsed.projects)
      if (!importedProjects.length) {
        throw new Error('Backup ini tidak berisi proyek yang valid.')
      }
      if (!window.confirm('Impor proyek ini? Proyek dengan ID yang sama akan diganti; proyek lokal lainnya tetap disimpan.')) {
        return
      }

      const currentRecord = snapshotCurrentProject()
      let merged = upsertProject(projects, currentRecord)
      for (const item of importedProjects) {
        merged = upsertProject(merged, item)
      }

      const preferredId = importedProjects.some(item => item.id === parsed.activeProjectId)
        ? parsed.activeProjectId
        : activeProjectId
      const target = merged.find(item => item.id === preferredId) || merged[0]
      const targetScenes = normalizeSavedScenes(target.scenes) || [defaultScene(1)]
      const targetActiveSceneId = targetScenes.some(scene => scene.id === target.activeSceneId)
        ? target.activeSceneId
        : targetScenes[0]?.id || ''
      const migratedTarget = migrateReusableRooms(targetScenes, target.floorplans, target.rooms)

      setProjects(merged)
      setActiveProjectId(target.id)
      setProject(normalizeSavedProject(target.project))
      setScenes(migratedTarget.scenes)
      setActiveSceneId(targetActiveSceneId)
      setFloorplans(migratedTarget.floorplans)
      setProjectRooms(migratedTarget.rooms)
      setTab('floorplan')
    } catch (error) {
      console.error('CINEBLOCK could not import backup:', error)
      window.alert(error.message || 'File backup tidak dapat diimpor.')
    } finally {
      input.value = ''
    }
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-left">
          <div className="topbar-brand" role="img" aria-label="CineBlock">
            <span className="topbar-mark" aria-hidden="true">
              <img className="topbar-mark-dark" src="/cineblock-mark.svg" alt="" />
              <img className="topbar-mark-light" src="/cineblock-mark-light.svg" alt="" />
            </span>
            <span className="topbar-wordmark">CINEBLOCK</span>
          </div>
          <span style={{ color: 'var(--text-muted)' }}>/</span>
          <select
            className="project-switcher"
            aria-label="Buka proyek"
            value={activeProjectId}
            onChange={event => switchProject(event.target.value)}
            disabled={!hydrated || projects.length === 0}
          >
            {projects.map(item => (
              <option key={item.id} value={item.id}>
                {item.id === activeProjectId
                  ? (project.title.trim() || 'Proyek tanpa judul')
                  : item.name}
              </option>
            ))}
          </select>
          <button className="btn btn-secondary" onClick={createNewProject} disabled={!hydrated}>
            <Plus size={14} /> Proyek Baru
          </button>
          <details className="project-actions-menu">
            <summary className="project-actions-trigger" aria-label="Menu pengelolaan proyek" title="Menu pengelolaan proyek"><MoreHorizontal size={17} /></summary>
            <div className="project-actions-popover">
              <button className="project-actions-delete" onClick={deleteCurrentProject} disabled={!hydrated || projects.length <= 1} title="Hapus proyek aktif"><Trash2 size={14} /> Hapus Proyek</button>
            </div>
          </details>
        </div>
        <div className="topbar-right">
          <span
            className={`save-status${saveStatus === 'saving' || saveStatus === 'loading' ? ' is-saving' : saveStatus === 'error' || saveStatus === 'conflict' ? ' is-error' : ''}`}
            aria-live="polite"
            title={externalSaveDetected ? "Data berubah di tab lain. Muat ulang halaman sebelum melanjutkan; perubahan lokal setelah konflik tidak akan disimpan." : "Proyek, Shot List, tab aktif, dan scene aktif disimpan di browser ini"}
            style={{ fontSize: 11, color: 'var(--text-muted)' }}
          >
            {saveStatus === 'loading'
              ? 'Memuat…'
              : saveStatus === 'saving'
                ? 'Menyimpan…'
                : saveStatus === 'conflict'
                  ? 'Data berubah di tab lain — muat ulang'
                  : saveStatus === 'error'
                    ? 'Gagal menyimpan'
                    : 'Tersimpan di perangkat ini'}
          </span>
          <button
            className="btn btn-secondary cloud-sync-trigger"
            type="button"
            onClick={() => { setCloudError(''); setSyncDialogOpen(true) }}
            title="Sinkronkan proyek ke perangkat lain"
          >
            <Cloud size={15} />
            <span>{cloudProjectId ? (cloudStatus === 'synced' ? 'Tersinkron' : 'Sinkronisasi') : 'Sinkronisasi'}</span>
          </button>
          <button
            className="btn btn-secondary theme-toggle"
            type="button"
            onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? 'Aktifkan tema terang' : 'Aktifkan tema gelap'}
            title={theme === 'dark' ? 'Aktifkan tema terang' : 'Aktifkan tema gelap'}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button className="btn btn-secondary" onClick={downloadBackup} disabled={!hydrated}>
            <Download size={13} /> Backup
          </button>
          <button className="btn btn-secondary" onClick={() => backupInputRef.current?.click()} disabled={!hydrated}>
            <Upload size={14} /> Impor
          </button>
          <input
            ref={backupInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={importBackup}
          />
          <button
            className="btn btn-primary"
            onClick={() => setExportDialogOpen(true)}
            disabled={!hydrated}
            title="Pilih bagian laporan dan orientasi halaman untuk PDF."
          >
            <Download size={13} />
            Ekspor PDF
          </button>
        </div>
      </div>

      {exportDialogOpen && (
        <div
          className="export-dialog-backdrop"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setExportDialogOpen(false)
          }}
        >
          <section className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-dialog-title">
            <header className="export-dialog-header">
              <div>
                <h2 id="export-dialog-title">Ekspor PDF</h2>
                <p>Pilih format konten dan orientasi halaman. Tabel tanpa Status/Storyboard. Di dialog cetak, matikan “Headers and footers” agar tanggal dan URL tidak tercetak di tepi.</p>
              </div>
              <button className="export-dialog-close" type="button" onClick={() => setExportDialogOpen(false)} aria-label="Tutup dialog ekspor">
                <X size={18} />
              </button>
            </header>

            <fieldset className="export-choice-group">
              <legend>Format ekspor</legend>
              <label className={'export-choice-card' + (exportMode === 'shotlist-table' ? ' selected' : '')}>
                <input type="radio" name="export-content" value="shotlist-table" checked={exportMode === 'shotlist-table'} onChange={() => { setExportMode('shotlist-table'); setExportOrientation('landscape') }} />
                <span className="export-choice-icon"><FileText size={20} /></span>
                <span className="export-choice-copy"><strong>Shot List — Tabel</strong><small>Tabel detail shot tanpa kolom Status, Storyboard, atau Aksi. Disarankan Landscape.</small></span>
              </label>
              <label className={'export-choice-card' + (exportMode === 'storyboard' ? ' selected' : '')}>
                <input type="radio" name="export-content" value="storyboard" checked={exportMode === 'storyboard'} onChange={() => { setExportMode('storyboard'); setExportOrientation('landscape') }} />
                <span className="export-choice-icon"><PanelsTopLeft size={20} /></span>
                <span className="export-choice-copy"><strong>Storyboard</strong><small>Susunan visual per shot dengan gambar storyboard dan informasi shot.</small></span>
              </label>
              <label className={'export-choice-card' + (exportMode === 'floorplan' ? ' selected' : '')}>
                <input type="radio" name="export-content" value="floorplan" checked={exportMode === 'floorplan'} onChange={() => { setExportMode('floorplan'); setExportOrientation('portrait') }} />
                <span className="export-choice-icon"><PanelsTopLeft size={20} /></span>
                <span className="export-choice-copy"><strong>Floorplan</strong><small>Denah untuk setiap scene.</small></span>
              </label>
              <label className={'export-choice-card' + (exportMode === 'full' ? ' selected' : '')}>
                <input type="radio" name="export-content" value="full" checked={exportMode === 'full'} onChange={() => { setExportMode('full'); setExportOrientation('portrait') }} />
                <span className="export-choice-icon"><FileText size={20} /></span>
                <span className="export-choice-copy"><strong>Laporan Lengkap</strong><small>Info proyek, Shot List dalam format tabel, dan Floorplan.</small></span>
              </label>
            </fieldset>

            <fieldset className="export-choice-group export-orientation-group">
              <legend>Orientasi halaman</legend>
              <label className={'export-orientation-card' + (exportOrientation === 'portrait' ? ' selected' : '')}>
                <input type="radio" name="export-orientation" value="portrait" checked={exportOrientation === 'portrait'} onChange={() => setExportOrientation('portrait')} />
                <RectangleVertical size={23} />
                <span><strong>Portrait</strong><small>Tegak</small></span>
              </label>
              <label className={'export-orientation-card' + (exportOrientation === 'landscape' ? ' selected' : '')}>
                <input type="radio" name="export-orientation" value="landscape" checked={exportOrientation === 'landscape'} onChange={() => setExportOrientation('landscape')} />
                <RectangleHorizontal size={27} />
                <span><strong>Landscape</strong><small>Mendatar</small></span>
              </label>
            </fieldset>

            <footer className="export-dialog-footer">
              <button className="btn btn-secondary" type="button" onClick={() => setExportDialogOpen(false)}>Batal</button>
              <button className="btn btn-primary" type="button" onClick={() => {
                setExportDialogOpen(false)
                setPrintRequest(true)
              }}>
                <Download size={14} /> Ekspor PDF
              </button>
            </footer>
          </section>
        </div>
      )}

      <div className="tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="content">
        {!hydrated ? (
          <div className="app-loading" role="status">Memuat data proyek…</div>
        ) : (
          <>
            {tab === 'project' && (
              <ProjectInfo project={project} onChange={setProject} />
            )}
            <div style={{ display: tab === 'shotlist' ? 'block' : 'none' }}>
              <ShotList
                scenes={scenes}
                onChange={setScenes}
                activeSceneId={activeSceneId}
                onActiveSceneChange={changeActiveScene}
                floorplans={floorplans}
                defaultShot={num => defaultShot(num, project.camera)}
                selectedShotId={selectedShotId}
                onSelectedShotIdChange={setSelectedShotId}
                onAddScene={addScene}
                onRenameScene={renameScene}
                onFloorplansChange={setFloorplans}
              />
            </div>
            <div className="floorplan-tab-panel" style={{ display: tab === 'floorplan' ? 'flex' : 'none' }}>
              <Floorplan
                isActive={tab === 'floorplan'}
                scenes={scenes}
                onChange={setScenes}
                activeSceneId={activeSceneId}
                onActiveSceneChange={changeActiveScene}
                onAddScene={addScene}
                onRenameScene={renameScene}
                defaultShot={num => defaultShot(num, project.camera)}
                selectedShotId={selectedShotId}
                onSelectedShotIdChange={setSelectedShotId}
                floorplans={floorplans}
                onFloorplansChange={setFloorplans}
                projectRooms={projectRooms}
                onProjectRoomsChange={setProjectRooms}
              />
            </div>
          </>
        )}
      </div>
      {hydrated && <PrintReport project={project} scenes={scenes} floorplans={resolvedFloorplans} mode={exportMode} orientation={exportOrientation} />}
      <CloudSyncDialog
        open={syncDialogOpen}
        onClose={() => setSyncDialogOpen(false)}
        configured={isCloudSyncConfigured()}
        projectName={project.title.trim() || 'Proyek tanpa judul'}
        displayName={displayName}
        onDisplayNameChange={setDisplayName}
        cloudStatus={cloudStatus}
        cloudRole={cloudRole}
        cloudProjectId={cloudProjectId}
        cloudError={cloudError}
        shareUrl={shareUrl}
        isOnline={isOnline}
        onConnect={handleConnectCloud}
        onCreateShareLink={handleCreateShareLink}
        onCopyShareLink={handleCopyShareLink}
        shareLinkToOpen={shareLinkToOpen}
        onShareLinkToOpenChange={setShareLinkToOpen}
        onOpenExistingCloudLink={handleOpenExistingCloudLink}
        onRetrySync={handleRetryCloudSync}
        onLoadRemote={handleLoadRemoteConflict}
        onOverwriteRemote={handleOverwriteRemoteConflict}
        conflictRemote={cloudConflict}
      />
    </div>
  )
}
