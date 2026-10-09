import { useEffect, useRef, useState } from 'react'
import './App.css'
import ProjectInfo from './components/ProjectInfo'
import ShotList from './components/ShotList'
import Floorplan from './components/Floorplan'
import { Download, Upload, Plus, Trash2 } from 'lucide-react'
import { loadAppState, saveAppState } from './storage'

const TABS = [
  { id: 'floorplan', label: 'Floorplan' },
  { id: 'shotlist', label: 'Shot List' },
  { id: 'project', label: 'Project Info' },
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

const defaultScene = (num) => ({
  id: crypto.randomUUID(),
  name: `Scene ${String(num).padStart(2, '0')}`,
  location: '',
  intExt: 'INT',
  dayNight: 'DAY',
  shots: [defaultShot(1)],
})

const defaultShot = (num) => ({
  id: crypto.randomUUID(),
  num: String(num).padStart(3, '0'),
  subject: '',
  size: '',
  camera: '',
  angle: '',
  lens: '',
  movements: [],
  equipment: [],
  sound: '',
  take: '',
  script: '',
  setup: '',
  estShoot: '',
  notes: '',
})

function createProjectRecord(id, project, scenes, activeSceneId, floorplans = {}) {
  const safeId = id || crypto.randomUUID()
  const safeTitle = project?.title?.trim() || 'Untitled Project'
  return {
    id: safeId,
    name: safeTitle,
    project,
    scenes,
    activeSceneId: activeSceneId || scenes[0]?.id || '',
    floorplans,
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
        type: opening.type === 'window' ? 'window' : 'door',
        offset: Math.max(0.02, Math.min(0.98, Number.isFinite(Number(opening.offset)) ? Number(opening.offset) : 0.5)),
        width: Math.max(12, Math.min(300, Number(opening.width) || (opening.type === 'window' ? 58 : 48))),
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
      rooms: (Array.isArray(raw.rooms) ? raw.rooms : []).filter(item => item && typeof item === 'object').slice(0, 200).map((item, index) => ({
        id: safeId(item),
        x: coords(item.x, 1000),
        y: coords(item.y, 650),
        width: Math.max(12, Math.min(1000, Number(item.width) || 100)),
        height: Math.max(12, Math.min(650, Number(item.height) || 80)),
        label: safeLabel(item.label, 'Room ' + String(index + 1).padStart(2, '0')),
        openings: normalizeOpenings(item.openings, true),
      })),
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
      ...(Array.isArray(raw.doors) ? raw.doors : []).filter(item => item && typeof item === 'object').map((item, index) => ({
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

function normalizeWorkspaceProjects(savedProjects) {
  if (!Array.isArray(savedProjects)) return []

  const seen = new Set()
  return savedProjects
    .filter(item => item && typeof item.id === 'string' && item.project && !seen.has(item.id) && seen.add(item.id))
    .map(item => {
      const normalizedProject = normalizeSavedProject(item.project)
      const normalizedScenes = normalizeSavedScenes(item.scenes) || [defaultScene(1)]
      const normalizedFloorplans = normalizeSavedFloorplans(item.floorplans, normalizedScenes)
      return {
        ...createProjectRecord(
          item.id,
          normalizedProject,
          normalizedScenes,
          item.activeSceneId || normalizedScenes[0]?.id || '',
          normalizedFloorplans,
        ),
        name: normalizedProject.title?.trim() || item.name || 'Untitled Project',
        updatedAt: item.updatedAt || new Date().toISOString(),
      }
    })
}

export default function App() {
  const [tab, setTab] = useState('floorplan')
  const [project, setProject] = useState(defaultProject)
  const [scenes, setScenes] = useState(() => [defaultScene(1)])
  const [activeSceneId, setActiveSceneId] = useState('')
  const [floorplans, setFloorplans] = useState({})
  const [projects, setProjects] = useState([])
  const [activeProjectId, setActiveProjectId] = useState('')
  const [hydrated, setHydrated] = useState(false)
  const [saveStatus, setSaveStatus] = useState('loading')
  const backupInputRef = useRef(null)

  useEffect(() => {
    let cancelled = false

    loadAppState()
      .then(savedState => {
        if (cancelled) return

        const restoredProject = normalizeSavedProject(savedState?.project)
        const restoredScenes = normalizeSavedScenes(savedState?.scenes) || scenes
        const restoredActiveSceneId = restoredScenes.some(scene => scene.id === savedState?.activeSceneId)
          ? savedState.activeSceneId
          : restoredScenes[0]?.id || ''
        let restoredProjects = normalizeWorkspaceProjects(savedState?.projects)
        let restoredProjectId = savedState?.activeProjectId || restoredProjects[0]?.id || crypto.randomUUID()
        const restoredFloorplans = normalizeSavedFloorplans(
          savedState?.floorplans ?? restoredProjects.find(item => item.id === restoredProjectId)?.floorplans,
          restoredScenes,
        )

        // Migrate the original single-project save into the project library.
        restoredProjects = upsertProject(
          restoredProjects,
          createProjectRecord(
            restoredProjectId,
            restoredProject,
            restoredScenes,
            restoredActiveSceneId,
            restoredFloorplans,
          ),
        )

        if (savedState?.tab === 'shotlist' || savedState?.tab === 'project' || savedState?.tab === 'floorplan') {
          setTab(savedState.tab)
        }

        setProject(restoredProject)
        setScenes(restoredScenes)
        setActiveSceneId(restoredActiveSceneId)
        setFloorplans(restoredFloorplans)
        setProjects(restoredProjects)
        setActiveProjectId(restoredProjectId)
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
    if (!hydrated || !activeProjectId) return undefined

    setSaveStatus('saving')
    const timeout = window.setTimeout(async () => {
      try {
        const currentRecord = createProjectRecord(activeProjectId, project, scenes, activeSceneId, floorplans)
        const savedProjects = upsertProject(projects, currentRecord)
        await saveAppState({
          tab,
          project,
          scenes,
          activeSceneId,
          floorplans,
          projects: savedProjects,
          activeProjectId,
        })
        setSaveStatus('saved')
      } catch (error) {
        console.error('CINEBLOCK could not save data:', error)
        setSaveStatus('error')
      }
    }, 250)

    return () => window.clearTimeout(timeout)
  }, [hydrated, tab, project, scenes, activeSceneId, floorplans, projects, activeProjectId])

  const snapshotCurrentProject = () => (
    createProjectRecord(activeProjectId, project, scenes, activeSceneId, floorplans)
  )

  const switchProject = (projectId) => {
    if (!projectId || projectId === activeProjectId) return
    const target = projects.find(item => item.id === projectId)
    if (!target) return

    setProjects(previous => upsertProject(previous, snapshotCurrentProject()))
    const targetScenes = normalizeSavedScenes(target.scenes) || [defaultScene(1)]
    const targetActiveSceneId = targetScenes.some(scene => scene.id === target.activeSceneId)
      ? target.activeSceneId
      : targetScenes[0]?.id || ''
    const targetFloorplans = normalizeSavedFloorplans(target.floorplans, targetScenes)
    setActiveProjectId(target.id)
    setProject(normalizeSavedProject(target.project))
    setScenes(targetScenes)
    setActiveSceneId(targetActiveSceneId)
    setFloorplans(targetFloorplans)
    setTab('floorplan')
  }

  const createNewProject = () => {
    const currentRecord = snapshotCurrentProject()
    const newProject = { ...defaultProject, visualRefs: [...defaultProject.visualRefs] }
    const newScenes = [defaultScene(1)]
    const newFloorplans = normalizeSavedFloorplans({}, newScenes)
    const newRecord = createProjectRecord(crypto.randomUUID(), newProject, newScenes, newScenes[0].id, newFloorplans)

    setProjects(previous => [...upsertProject(previous, currentRecord), newRecord])
    setActiveProjectId(newRecord.id)
    setProject(newProject)
    setScenes(newScenes)
    setActiveSceneId(newScenes[0].id)
    setFloorplans(newFloorplans)
    setTab('floorplan')
  }

  const deleteCurrentProject = () => {
    if (projects.length <= 1) {
      window.alert('CINEBLOCK needs at least one project. Create another project before deleting this one.')
      return
    }
    if (!window.confirm('Delete this project and all its scenes and shots from this browser? This cannot be undone.')) return

    const remaining = projects.filter(item => item.id !== activeProjectId)
    const target = remaining[0]
    const targetScenes = normalizeSavedScenes(target.scenes) || [defaultScene(1)]
    const targetActiveSceneId = targetScenes.some(scene => scene.id === target.activeSceneId)
      ? target.activeSceneId
      : targetScenes[0]?.id || ''
    const targetFloorplans = normalizeSavedFloorplans(target.floorplans, targetScenes)
    setProjects(remaining)
    setActiveProjectId(target.id)
    setProject(normalizeSavedProject(target.project))
    setScenes(targetScenes)
    setActiveSceneId(targetActiveSceneId)
    setFloorplans(targetFloorplans)
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
      const parsed = JSON.parse(await file.text())
      if (parsed?.app !== 'CINEBLOCK' || !Array.isArray(parsed.projects)) {
        throw new Error('This file is not a valid CINEBLOCK backup.')
      }
      const importedProjects = normalizeWorkspaceProjects(parsed.projects)
      if (!importedProjects.length) {
        throw new Error('The backup does not contain any valid projects.')
      }
      if (!window.confirm('Import these projects? Matching project IDs will be replaced; other local projects will be kept.')) {
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
      const targetFloorplans = normalizeSavedFloorplans(target.floorplans, targetScenes)

      setProjects(merged)
      setActiveProjectId(target.id)
      setProject(normalizeSavedProject(target.project))
      setScenes(targetScenes)
      setActiveSceneId(targetActiveSceneId)
      setFloorplans(targetFloorplans)
      setTab('floorplan')
    } catch (error) {
      console.error('CINEBLOCK could not import backup:', error)
      window.alert(error.message || 'The backup file could not be imported.')
    } finally {
      input.value = ''
    }
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-left">
          <span className="topbar-logo">CINEBLOCK</span>
          <span style={{ color: 'var(--text-muted)' }}>/</span>
          <select
            className="project-switcher"
            aria-label="Open project"
            value={activeProjectId}
            onChange={event => switchProject(event.target.value)}
            disabled={!hydrated || projects.length === 0}
          >
            {projects.map(item => (
              <option key={item.id} value={item.id}>
                {item.id === activeProjectId
                  ? (project.title.trim() || 'Untitled Project')
                  : item.name}
              </option>
            ))}
          </select>
          <button className="btn btn-secondary" onClick={createNewProject} disabled={!hydrated}>
            <Plus size={13} /> New Project
          </button>
          <button
            className="btn btn-danger"
            onClick={deleteCurrentProject}
            disabled={!hydrated || projects.length <= 1}
            title="Delete current project"
          >
            <Trash2 size={13} /> Delete
          </button>
        </div>
        <div className="topbar-right">
          <span
            aria-live="polite"
            title="Projects, shot lists, active tab, and active scene are saved locally in this browser"
            style={{ fontSize: 11, color: 'var(--text-muted)' }}
          >
            {saveStatus === 'loading'
              ? 'Loading…'
              : saveStatus === 'saving'
                ? 'Saving…'
                : saveStatus === 'error'
                  ? 'Save failed'
                  : 'Saved locally'}
          </span>
          <button className="btn btn-secondary" onClick={downloadBackup} disabled={!hydrated}>
            <Download size={13} /> Backup
          </button>
          <button className="btn btn-secondary" onClick={() => backupInputRef.current?.click()} disabled={!hydrated}>
            <Upload size={13} /> Import
          </button>
          <input
            ref={backupInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={importBackup}
          />
          <button
            className="btn btn-secondary"
            style={{ fontSize: 12 }}
            disabled
            title="PDF export is planned as the final feature"
          >
            <Download size={13} />
            Export PDF
          </button>
        </div>
      </div>

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
          <div className="app-loading" role="status">Loading saved project…</div>
        ) : (
          <>
            {tab === 'project' && (
              <ProjectInfo project={project} onChange={setProject} />
            )}
            {tab === 'shotlist' && (
              <ShotList
                scenes={scenes}
                onChange={setScenes}
                activeSceneId={activeSceneId}
                onActiveSceneChange={setActiveSceneId}
                defaultShot={defaultShot}
                defaultScene={defaultScene}
              />
            )}
            {tab === 'floorplan' && (
              <Floorplan
                scenes={scenes}
                onChange={setScenes}
                activeSceneId={activeSceneId}
                onActiveSceneChange={setActiveSceneId}
                defaultShot={defaultShot}
                defaultScene={defaultScene}
                floorplans={floorplans}
                onFloorplansChange={setFloorplans}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
