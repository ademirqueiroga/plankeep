import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type Config, type DocSummary, type GitState, type TreeNode } from '../api'
import type { View } from '../App'
import { ContextMenu, type MenuItem, type MenuState } from './ContextMenu'

const TYPE_ICONS: Record<string, string> = {
  plan: '◫',
  findings: '◎',
  exploration: '✧',
  research: '❖',
  note: '≡',
}

interface SidebarProps {
  tree: TreeNode | null
  queue: DocSummary[]
  view: View
  inboxCount: number
  git: GitState | null
  config: Config | null
  width: number
  setView: (v: View) => void
  openDoc: (path: string) => void
  refresh: () => Promise<void>
}

export function Sidebar(props: SidebarProps) {
  const { tree, queue, view, inboxCount, git, config, width, setView, openDoc, refresh } = props
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [lastClicked, setLastClicked] = useState<string | null>(null)
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({})
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [treeDropOver, setTreeDropOver] = useState(false)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const dragDepth = useRef(0)

  // an aborted drag (Esc) fires no drop/dragleave on our elements — clear any stuck highlight
  useEffect(() => {
    const onDragEnd = () => {
      setDropTarget(null)
      setTreeDropOver(false)
      dragDepth.current = 0
    }
    window.addEventListener('dragend', onDragEnd)
    return () => window.removeEventListener('dragend', onDragEnd)
  }, [])

  const isOpen = useCallback((path: string) => openFolders[path] !== false, [openFolders])

  /** Visible docs in display order — used for shift-click range selection. */
  const visibleDocs = useMemo(() => {
    const out: string[] = []
    const walk = (node: TreeNode) => {
      for (const child of node.children ?? []) {
        if (child.kind === 'folder') {
          if (isOpen(child.path)) walk(child)
        } else out.push(child.path)
      }
    }
    if (tree) walk(tree)
    return out
  }, [tree, isOpen])

  const absOf = (rel: string) => (config ? `${config.vaultPath}/${rel}` : rel)

  // ----- selection -----
  const handleDocClick = (path: string, e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(selected)
      next.has(path) ? next.delete(path) : next.add(path)
      setSelected(next)
      setLastClicked(path)
    } else if (e.shiftKey && lastClicked) {
      const a = visibleDocs.indexOf(lastClicked)
      const b = visibleDocs.indexOf(path)
      if (a !== -1 && b !== -1) {
        setSelected(new Set(visibleDocs.slice(Math.min(a, b), Math.max(a, b) + 1)))
      }
    } else {
      setSelected(new Set([path]))
      setLastClicked(path)
      openDoc(path)
    }
  }

  // ----- drag & drop -----
  const startDrag = (path: string, e: React.DragEvent) => {
    const paths = selected.has(path) ? [...selected] : [path]
    if (!selected.has(path)) setSelected(new Set([path]))
    e.dataTransfer.setData('application/x-plankeep-paths', JSON.stringify(paths))
    e.dataTransfer.effectAllowed = 'move'
  }

  const moveInternal = async (paths: string[], folder: string) => {
    for (const from of paths) {
      const to = folder ? `${folder}/${from.split('/').pop()}` : from.split('/').pop()!
      if (to !== from) await api.move(from, to)
    }
    setSelected(new Set())
    await refresh()
  }

  /**
   * External file drop. Browsers hide the source path, so we resolve the file
   * name back to a real file in the scan roots: a hit lets us import from disk
   * (copy/move works, source recorded) and auto-file under its project folder.
   */
  const importExternal = async (files: File[], folder: string | null) => {
    for (const file of files) {
      if (!file.name.endsWith('.md')) continue
      const hits = await api.resolveSource(file.name)
      if (hits.length >= 1) {
        await api.importFile(hits[0].path, folder ?? hits[0].project, undefined, hits[0].project)
      } else {
        await api.importContent(file.name, await file.text(), folder ?? '')
      }
    }
    await refresh()
  }

  const handleDrop = async (e: React.DragEvent, folder: string | null) => {
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current = 0
    setTreeDropOver(false)
    setDropTarget(null)
    const internal = e.dataTransfer.getData('application/x-plankeep-paths')
    if (internal) await moveInternal(JSON.parse(internal), folder ?? '')
    else await importExternal(Array.from(e.dataTransfer.files), folder)
  }

  // ----- context menus -----
  const confirmDeleteFolder = async (path: string) => {
    const { docs } = await api.folderStats(path)
    const name = path.split('/').pop()!
    if (docs > 0) {
      const typed = window.prompt(`Delete folder "${path}" and its ${docs} document(s)?\nType the folder name to confirm:`)
      if (typed !== name) return
    } else if (!window.confirm(`Delete empty folder "${path}"?`)) return
    await api.deleteFolder(path)
    await refresh()
  }

  const docMenu = (path: string): MenuItem[] => {
    const multi = selected.has(path) && selected.size > 1
    if (multi) {
      const paths = [...selected]
      return [
        { label: `Add ${paths.length} to Up Next`, onClick: async () => { for (const p of paths) await api.queueAdd(p); await refresh() } },
        { label: `Copy ${paths.length} paths`, onClick: () => navigator.clipboard.writeText(paths.map(absOf).join('\n')) },
        { label: 'Move to folder…', onClick: async () => {
          const folder = window.prompt('Destination folder (empty = vault root):')
          if (folder !== null) await moveInternal(paths, folder.trim().replace(/^\/+|\/+$/g, ''))
        } },
        { separator: true },
        { label: `Delete ${paths.length} documents…`, danger: true, onClick: async () => {
          if (!window.confirm(`Delete ${paths.length} documents? (history stays in vault git)`)) return
          for (const p of paths) await api.deleteDoc(p)
          setSelected(new Set())
          await refresh()
        } },
      ]
    }
    return [
      { label: 'Open', onClick: () => openDoc(path) },
      { label: 'Add to Up Next', onClick: () => api.queueAdd(path).then(refresh) },
      { separator: true },
      { label: 'Rename / Move…', onClick: async () => {
        const to = window.prompt('New vault-relative path:', path)
        if (to && to !== path) { await api.move(path, to); await refresh(); openDoc(to) }
      } },
      { label: 'Copy path', hint: 'vault', onClick: () => navigator.clipboard.writeText(path) },
      { label: 'Copy absolute path', onClick: () => navigator.clipboard.writeText(absOf(path)) },
      { label: 'Reveal in Finder', onClick: () => api.reveal({ path }) },
      { separator: true },
      { label: 'Delete…', danger: true, onClick: async () => {
        if (window.confirm(`Delete ${path}? (history stays in vault git)`)) {
          await api.deleteDoc(path)
          await refresh()
        }
      } },
    ]
  }

  const folderMenu = (path: string): MenuItem[] => [
    { label: 'New subfolder…', onClick: async () => {
      const name = window.prompt('Subfolder name:')
      if (name?.trim()) { await api.createFolder(`${path}/${name.trim()}`); await refresh() }
    } },
    { label: 'Rename…', onClick: async () => {
      const name = window.prompt('New folder name:', path.split('/').pop())
      if (name?.trim()) {
        const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
        const to = parent ? `${parent}/${name.trim()}` : name.trim()
        if (to !== path) { await api.renameFolder(path, to); await refresh() }
      }
    } },
    { separator: true },
    { label: 'Copy path', onClick: () => navigator.clipboard.writeText(absOf(path)) },
    { label: 'Reveal in Finder', onClick: () => api.reveal({ path }) },
    { separator: true },
    { label: 'Delete folder…', danger: true, onClick: () => confirmDeleteFolder(path) },
  ]

  const backgroundMenu = (): MenuItem[] => [
    { label: 'New folder…', onClick: async () => {
      const name = window.prompt('Folder name (use / for nesting):')
      if (name?.trim()) { await api.createFolder(name.trim()); await refresh() }
    } },
    { label: 'Scan for plans', onClick: async () => { await api.scan(); await refresh() } },
  ]

  const showMenu = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  // ----- git status pill -----
  const syncState = !git
    ? { cls: 'off', label: '…' }
    : git.conflicted || git.lastError
      ? { cls: 'error', label: git.conflicted ? 'Conflict' : 'Sync error' }
      : !git.remote
        ? { cls: 'off', label: 'Local only' }
        : git.dirty + git.ahead + git.behind > 0
          ? { cls: 'pending', label: `${git.dirty + git.ahead + git.behind} pending` }
          : { cls: 'ok', label: 'Synced' }

  const renderChildren = (node: TreeNode, depth: number): React.ReactNode =>
    node.children?.map((child) =>
      child.kind === 'folder' ? (
        <div key={child.path}>
          <div
            className={`tree-row folder-row${dropTarget === child.path ? ' drop-target' : ''}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => setOpenFolders({ ...openFolders, [child.path]: !isOpen(child.path) })}
            onContextMenu={(e) => showMenu(e, folderMenu(child.path))}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropTarget(child.path) }}
            onDrop={(e) => handleDrop(e, child.path)}
          >
            <span className={`chevron${isOpen(child.path) ? ' open' : ''}`}>›</span>
            <span className="row-label">{child.name}</span>
            <span className="row-count">{child.children?.filter((c) => c.kind === 'doc').length || ''}</span>
          </div>
          {isOpen(child.path) && renderChildren(child, depth + 1)}
        </div>
      ) : (
        <div
          key={child.path}
          className={`tree-row doc-row${view.kind === 'doc' && view.path === child.path ? ' active' : ''}${selected.has(child.path) ? ' selected' : ''} status-${child.doc!.meta.status}`}
          style={{ paddingLeft: 8 + depth * 14 + 14 }}
          draggable
          onDragStart={(e) => startDrag(child.path, e)}
          onClick={(e) => handleDocClick(child.path, e)}
          onContextMenu={(e) => {
            if (!selected.has(child.path)) setSelected(new Set([child.path]))
            showMenu(e, docMenu(child.path))
          }}
          title={child.path}
        >
          <span className="doc-glyph">{TYPE_ICONS[child.doc!.meta.type] ?? '≡'}</span>
          <span className="row-label">{child.doc!.title}</span>
          {child.doc!.progress.total > 0 && (
            <span className={`row-progress${child.doc!.progress.done === child.doc!.progress.total ? ' done' : ''}`}>
              {child.doc!.progress.done}/{child.doc!.progress.total}
            </span>
          )}
        </div>
      ),
    )

  return (
    <aside className="sidebar" style={{ width }}>
      <div className="brand">PlanKeep</div>

      <nav className="nav">
        <button className={`nav-item${view.kind === 'inbox' ? ' active' : ''}`} onClick={() => setView({ kind: 'inbox' })}>
          <span className="nav-glyph">▣</span> Inbox
          {inboxCount > 0 && <span className="badge">{inboxCount}</span>}
        </button>
      </nav>

      <section className="side-section queue-section">
        <button className={`section-header${view.kind === 'queue' ? ' active' : ''}`} onClick={() => setView({ kind: 'queue' })}>
          Up Next <span className="section-count">{queue.length}</span>
        </button>
        {queue.length > 0 && (
          <div className="queue-preview">
            {queue.map((d, i) => (
              <div
                key={d.path}
                className={`queue-mini${view.kind === 'doc' && view.path === d.path ? ' active' : ''}`}
                onClick={() => openDoc(d.path)}
                title={d.path}
              >
                <span className="queue-mini-pos">{i + 1}</span>
                <span className="row-label">{d.title}</span>
                {d.progress.total > 0 && (
                  <span className="mini-bar">
                    <span className="mini-bar-fill" style={{ width: `${(d.progress.done / d.progress.total) * 100}%` }} />
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section
        className={`side-section tree-section${treeDropOver ? ' drop-over' : ''}`}
        onContextMenu={(e) => showMenu(e, backgroundMenu())}
        onDragEnter={(e) => { e.preventDefault(); dragDepth.current++; setTreeDropOver(true) }}
        onDragLeave={() => { dragDepth.current--; if (dragDepth.current <= 0) { setTreeDropOver(false); setDropTarget(null) } }}
        onDragOver={(e) => { e.preventDefault(); setDropTarget('') }}
        onDrop={(e) => handleDrop(e, null)}
      >
        <div className="section-header static">
          Vault
          <button
            className="icon-btn"
            title="New folder"
            onClick={async () => {
              const name = window.prompt('Folder name (use / for nesting):')
              if (name?.trim()) { await api.createFolder(name.trim()); await refresh() }
            }}
          >
            +
          </button>
        </div>
        <div className="tree" onClick={(e) => { if (e.target === e.currentTarget) setSelected(new Set()) }}>
          {tree?.children?.length ? (
            renderChildren(tree, 0)
          ) : (
            <div className="tree-empty">
              Vault is empty. Drop .md files anywhere here, triage the Inbox, or let Claude save plans via MCP.
            </div>
          )}
        </div>
        <div className={`drop-hint${dropTarget !== null ? ' active' : ''}`}>
          {dropTarget === null
            ? "Drop .md files anywhere in this area — they're filed under their source project"
            : dropTarget === ''
              ? 'Drop to import at vault root'
              : `Drop into ${dropTarget}`}
        </div>
      </section>

      <footer className="side-footer">
        <button className={`sync-pill ${syncState.cls}`} title="Git sync state — open settings" onClick={() => setView({ kind: 'settings' })}>
          <span className="sync-dot" /> {syncState.label}
        </button>
        <button
          className={`icon-btn gear${view.kind === 'settings' ? ' active' : ''}`}
          title="Settings"
          onClick={() => setView({ kind: 'settings' })}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </footer>

      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </aside>
  )
}
