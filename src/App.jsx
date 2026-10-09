import { useEffect, useState } from 'react'
import './App.css'
import ProjectInfo from './components/ProjectInfo'
import ShotList from './components/ShotList'
import { Download } from 'lucide-react'

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

const STORAGE_KEY = 'cineblock.app-state.v1'

function readSavedState() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (!saved) return null

    const parsed = JSON.parse(saved)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch (error) {
    console.warn('CINEBLOCK could not read saved data:', error)
    return null
  }
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
          equipment: shot.equipment ?? shot.support ?? '',
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
  equipment: '',
  sound: '',
  take: '',
  script: '',
  setup: '',
  estShoot: '',
  notes: '',
})

export default function App() {
  const [savedState] = useState(() => readSavedState())
  const [tab, setTab] = useState(() => (
    savedState?.tab === 'shotlist' ? 'shotlist' : 'project'
  ))
  const [project, setProject] = useState(() => normalizeSavedProject(savedState?.project))
  const [scenes, setScenes] = useState(() => normalizeSavedScenes(savedState?.scenes) || [defaultScene(1)])
  const [saveStatus, setSaveStatus] = useState('saved')

  useEffect(() => {
    setSaveStatus('saving')
    const timeout = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ tab, project, scenes }))
        setSaveStatus('saved')
      } catch (error) {
        console.error('CINEBLOCK could not save data:', error)
        setSaveStatus('error')
      }
    }, 300)

    return () => window.clearTimeout(timeout)
  }, [tab, project, scenes])

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
            title="Project and shot list data are saved in this browser"
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
            defaultShot={defaultShot}
            defaultScene={defaultScene}
          />
        )}
      </div>
    </div>
  )
}
