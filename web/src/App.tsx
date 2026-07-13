import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type AiJob, type Config, type DocSummary, type GitState, type TreeNode } from './api'
import { Sidebar } from './components/Sidebar'
import { DocView } from './components/DocView'
import { QueueView } from './components/QueueView'
import { InboxView } from './components/InboxView'
import { SettingsView } from './components/SettingsView'
import { SearchView } from './components/SearchView'
import { ActivityView } from './components/ActivityView'
import { MemoriesView } from './components/MemoriesView'
import { DialogHost, dialog } from './components/Dialog'
import { Tooltip } from './components/Tooltip'
import { Palette } from './components/Palette'
import { buildCommands, matchesShortcut, type DocApi } from './shortcuts'

export type View =
  | { kind: 'doc'; path: string }
  | { kind: 'queue' }
  | { kind: 'inbox' }
  | { kind: 'search' }
  | { kind: 'settings' }
  | { kind: 'activity' }
  | { kind: 'memories' }
  | { kind: 'memory'; slug: string; file: string; displayName: string; title: string }

const VIEW_TITLES: Record<string, string> = {
  queue: 'Up Next',
  inbox: 'Inbox',
  search: 'Search',
  settings: 'Settings',
  activity: 'Activity',
  memories: 'Memories',
}

export default function App() {
  const [view, setView] = useState<View>({ kind: 'queue' })
  const [tree, setTree] = useState<TreeNode | null>(null)
  const [queue, setQueue] = useState<DocSummary[]>([])
  const [inboxCount, setInboxCount] = useState(0)
  const [aiJobs, setAiJobs] = useState<AiJob[]>([])
  const [git, setGit] = useState<GitState | null>(null)
  const [config, setConfig] = useState<Config | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(() => Number(localStorage.getItem('pk-sidebar-width')) || 280)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('pk-sidebar-collapsed') === '1')
  const [panelCollapsed, setPanelCollapsed] = useState(() => localStorage.getItem('pk-doc-panel-collapsed') === '1')
  const resizing = useRef(false)
  const docApiRef = useRef<DocApi | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)

  const toggleSidebar = useCallback(() => setSidebarCollapsed((c) => !c), [])

  useEffect(() => {
    localStorage.setItem('pk-sidebar-collapsed', sidebarCollapsed ? '1' : '0')
  }, [sidebarCollapsed])

  const refresh = useCallback(async () => {
    const [t, q, inbox, g, meta, jobs] = await Promise.all([api.tree(), api.queue(), api.inbox(), api.gitStatus(), api.meta(), api.aiJobs()])
    setTree(t)
    setQueue(q)
    setInboxCount(inbox.length)
    setGit(g)
    setConfig(meta.config)
    setAiJobs(jobs)
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 30_000)
    return () => clearInterval(timer)
  }, [refresh])

  const openDoc = useCallback((path: string) => setView({ kind: 'doc', path }), [])

  // global shortcuts: ⌘K/Ctrl+K and ⌥Space toggle the command palette,
  // single-key document shortcuts dispatch through the shared command list.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || dialog.isOpen()) return
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'
      // e.key for Alt+Space is a non-breaking space on macOS — e.code is the reliable check.
      const isOptSpace = e.altKey && e.code === 'Space'
      if (isCmdK || isOptSpace) {
        e.preventDefault()
        setPaletteOpen((o) => !o)
        return
      }
      if (paletteOpen) return
      const target = e.target as HTMLElement
      const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable
      if (isTyping) return
      const ctx = { view, setView, openDoc, refresh, docApi: docApiRef.current ?? undefined, toggleSidebar }
      for (const cmd of buildCommands(ctx)) {
        if (!cmd.keys || !matchesShortcut(cmd.keys, e)) continue
        if (cmd.when && !cmd.when(ctx)) continue
        e.preventDefault()
        cmd.run(ctx)
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, refresh, openDoc, paletteOpen, toggleSidebar])

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

  const aiRunningCount = aiJobs.filter((j) => j.status === 'running').length

  const crumb =
    view.kind === 'doc'
      ? view.path.split('/')
      : view.kind === 'memory'
        ? ['Memories', view.displayName, view.title]
        : [VIEW_TITLES[view.kind]]

  return (
    <div className="app">
      {!sidebarCollapsed && (
        <>
          <Sidebar
            tree={tree}
            queue={queue}
            view={view}
            inboxCount={inboxCount}
            aiRunningCount={aiRunningCount}
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
        </>
      )}
      <div className="content">
        <header className="topbar">
          <div className="topbar-group">
            <Tooltip label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'} keys="[">
              <button className="icon-btn topbar-btn" onClick={toggleSidebar}>
                <PanelLeftIcon />
              </button>
            </Tooltip>
            <nav className="breadcrumb">
              {crumb.map((part, i) => (
                <span key={i} className="crumb-part">
                  {i > 0 && <span className="crumb-sep">/</span>}
                  {part}
                </span>
              ))}
            </nav>
          </div>
          <div className="topbar-group">
            {view.kind === 'doc' && (
              <Tooltip label={panelCollapsed ? 'Show panel' : 'Hide panel'} keys="]">
                <button className={`icon-btn topbar-btn${panelCollapsed ? ' active' : ''}`} onClick={() => docApiRef.current?.togglePanel()}>
                  <PanelRightIcon />
                </button>
              </Tooltip>
            )}
            <Tooltip label="Search or run a command" keys="⌘K">
              <button className="icon-btn topbar-btn" onClick={() => setPaletteOpen(true)}>
                <SearchIcon />
              </button>
            </Tooltip>
          </div>
        </header>
        <main className={`main${view.kind === 'doc' ? ' main-doc' : ''}`}>
          {view.kind === 'doc' && (
            <DocView
              key={view.path}
              path={view.path}
              config={config}
              refresh={refresh}
              onDeleted={() => setView({ kind: 'queue' })}
              onMoved={openDoc}
              onDocApi={(api) => { docApiRef.current = api }}
              onOpenActivity={() => setView({ kind: 'activity' })}
              onPanelCollapsedChange={setPanelCollapsed}
            />
          )}
          {view.kind === 'queue' && <QueueView openDoc={openDoc} refresh={refresh} />}
          {view.kind === 'inbox' && <InboxView config={config} openDoc={openDoc} refresh={refresh} />}
          {view.kind === 'search' && <SearchView openDoc={openDoc} />}
          {view.kind === 'settings' && <SettingsView refresh={refresh} />}
          {view.kind === 'activity' && <ActivityView openDoc={openDoc} />}
          {(view.kind === 'memories' || view.kind === 'memory') && <MemoriesView view={view} setView={setView} />}
        </main>
      </div>
      <Palette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        view={view}
        setView={setView}
        openDoc={openDoc}
        refresh={refresh}
        docApi={docApiRef.current}
        toggleSidebar={toggleSidebar}
      />
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

function PanelLeftIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
      <rect x="1.5" y="2.5" width="4.5" height="11" rx="1" fill="currentColor" fillOpacity="0.3" stroke="none" />
    </svg>
  )
}

function PanelRightIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
      <rect x="10" y="2.5" width="4.5" height="11" rx="1" fill="currentColor" fillOpacity="0.3" stroke="none" />
    </svg>
  )
}
