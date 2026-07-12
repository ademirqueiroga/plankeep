import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Config, type DocSummary, type GitState, type TreeNode } from './api'
import { Sidebar } from './components/Sidebar'
import { DocView } from './components/DocView'
import { QueueView } from './components/QueueView'
import { InboxView } from './components/InboxView'
import { SettingsView } from './components/SettingsView'
import { SearchView } from './components/SearchView'
import { DialogHost } from './components/Dialog'

export type View =
  | { kind: 'doc'; path: string }
  | { kind: 'queue' }
  | { kind: 'inbox' }
  | { kind: 'search' }
  | { kind: 'settings' }

const VIEW_TITLES: Record<string, string> = {
  queue: 'Up Next',
  inbox: 'Inbox',
  search: 'Search',
  settings: 'Settings',
}

export default function App() {
  const [view, setView] = useState<View>({ kind: 'queue' })
  const [tree, setTree] = useState<TreeNode | null>(null)
  const [queue, setQueue] = useState<DocSummary[]>([])
  const [inboxCount, setInboxCount] = useState(0)
  const [git, setGit] = useState<GitState | null>(null)
  const [config, setConfig] = useState<Config | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(() => Number(localStorage.getItem('pk-sidebar-width')) || 280)
  const resizing = useRef(false)

  const refresh = useCallback(async () => {
    const [t, q, inbox, g, meta] = await Promise.all([api.tree(), api.queue(), api.inbox(), api.gitStatus(), api.meta()])
    setTree(t)
    setQueue(q)
    setInboxCount(inbox.length)
    setGit(g)
    setConfig(meta.config)
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 30_000)
    return () => clearInterval(timer)
  }, [refresh])

  // cmd/ctrl+K -> search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setView({ kind: 'search' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // sidebar resize by dragging the right edge
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!resizing.current) return
      const w = Math.min(480, Math.max(220, e.clientX))
      setSidebarWidth(w)
    }
    const up = () => {
      if (resizing.current) {
        resizing.current = false
        document.body.classList.remove('resizing')
        setSidebarWidth((w) => {
          localStorage.setItem('pk-sidebar-width', String(w))
          return w
        })
      }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  const openDoc = useCallback((path: string) => setView({ kind: 'doc', path }), [])

  const crumb =
    view.kind === 'doc'
      ? view.path.split('/')
      : [VIEW_TITLES[view.kind]]

  return (
    <div className="app">
      <Sidebar
        tree={tree}
        queue={queue}
        view={view}
        inboxCount={inboxCount}
        git={git}
        config={config}
        width={sidebarWidth}
        setView={setView}
        openDoc={openDoc}
        refresh={refresh}
      />
      <div
        className="resize-handle"
        onMouseDown={() => {
          resizing.current = true
          document.body.classList.add('resizing')
        }}
      />
      <div className="content">
        <header className="topbar">
          <nav className="breadcrumb">
            {crumb.map((part, i) => (
              <span key={i} className="crumb-part">
                {i > 0 && <span className="crumb-sep">/</span>}
                {part}
              </span>
            ))}
          </nav>
          <button className="icon-btn topbar-btn" title="Search (⌘K)" onClick={() => setView({ kind: 'search' })}>
            <SearchIcon />
          </button>
        </header>
        <main className="main">
          {view.kind === 'doc' && (
            <DocView key={view.path} path={view.path} config={config} refresh={refresh} onDeleted={() => setView({ kind: 'queue' })} onMoved={openDoc} />
          )}
          {view.kind === 'queue' && <QueueView openDoc={openDoc} refresh={refresh} />}
          {view.kind === 'inbox' && <InboxView config={config} openDoc={openDoc} refresh={refresh} />}
          {view.kind === 'search' && <SearchView openDoc={openDoc} />}
          {view.kind === 'settings' && <SettingsView refresh={refresh} />}
        </main>
      </div>
      <DialogHost />
    </div>
  )
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" strokeLinecap="round" />
    </svg>
  )
}
