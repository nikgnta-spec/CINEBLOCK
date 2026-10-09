import { useState } from 'react'
import './App.css'
import ProjectInfo from './components/ProjectInfo'
import ShotList from './components/ShotList'
import { FileText, List, Download } from 'lucide-react'

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
  support: '',
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
  const [scenes, setScenes] = useState([defaultScene(1)])

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
