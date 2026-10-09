import { useEffect, useState } from 'react'
import './App.css'
import ProjectInfo from './components/ProjectInfo'
import ShotList from './components/ShotList'
import { Download } from 'lucide-react'
import { loadAppState, saveAppState } from './storage'

const TABS = [
  { id: 'project', label: 'Project Info' },
  { id: 'shotlist', label: 'Shot List' },
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
}

function normalizeSavedProject(savedProject) {
  const refs = Array.isArray(savedProject?.visualRefs)
    ? savedProject.visualRefs
    : defaultProject.visualRefs

  return {
    ...defaultProject,
    ...(savedProject || {}),
    visualRefs: Array.from(
      { length: Math.max(6, refs.length) },
      (_, index) => refs[index] ?? null,
    ),
  }
}

function normalizeSavedScenes(savedScenes) {
  if (!Array.isArray(savedScenes) || savedScenes.length === 0) return null

  return savedScenes.map(scene => ({
    ...scene,
    shots: Array.isArray(scene.shots)
      ? scene.shots.map(shot => ({
          ...shot,
          movements: Array.isArray(shot.movements) ? shot.movements : [],
          // Keep projects created before the Support -> Equipment rename readable.
          equipment: Array.isArray(shot.equipment)
            ? shot.equipment
            : shot.equipment
              ? [shot.equipment]
              : shot.support
                ? [shot.support]
                : [],
        }))
      : [],
  }))
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

export default function App() {
  const [tab, setTab] = useState('project')
  const [project, setProject] = useState(defaultProject)
  const [scenes, setScenes] = useState(() => [defaultScene(1)])
  const [activeSceneId, setActiveSceneId] = useState('')
  const [hydrated, setHydrated] = useState(false)
  const [saveStatus, setSaveStatus] = useState('loading')

  useEffect(() => {
    let cancelled = false

    loadAppState()
      .then(savedState => {
        if (cancelled) return

        if (savedState?.project) {
          setProject(normalizeSavedProject(savedState.project))
        }

        const restoredScenes = normalizeSavedScenes(savedState?.scenes)
        if (restoredScenes) {
          setScenes(restoredScenes)
        }

        if (savedState?.tab === 'shotlist' || savedState?.tab === 'project') {
          setTab(savedState.tab)
        }

        setActiveSceneId(
          savedState?.activeSceneId
            || restoredScenes?.[0]?.id
            || '',
        )
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
  }, [])

  useEffect(() => {
    if (!hydrated) return undefined

    setSaveStatus('saving')
    const timeout = window.setTimeout(async () => {
      try {
        await saveAppState({ tab, project, scenes, activeSceneId })
        setSaveStatus('saved')
      } catch (error) {
        console.error('CINEBLOCK could not save data:', error)
        setSaveStatus('error')
      }
    }, 250)

    return () => window.clearTimeout(timeout)
  }, [hydrated, tab, project, scenes, activeSceneId])

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-left">
          <span className="topbar-logo">CINEBLOCK</span>
          <div className="topbar-project">
            <span style={{ color: 'var(--text-muted)' }}>/</span>
            <span>{project.title || 'Untitled Project'}</span>
          </div>
        </div>
        <div className="topbar-right">
          <span
            aria-live="polite"
            title="Project, shot list, active tab, and active scene are saved on this device"
            style={{ fontSize: 11, color: 'var(--text-muted)' }}
          >
            {saveStatus === 'saving'
              ? 'Saving…'
              : saveStatus === 'error'
                ? 'Save failed'
                : 'Saved locally'}
          </span>
          <button className="btn btn-secondary" style={{ fontSize: 12 }}>
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
      </div>
    </div>
  )
}
