import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type ClaudeActivity, type DocSummary, type GitState, type TreeNode, type VaultEntry } from '../api'
import type { View } from '../App'
import { ContextMenu, type MenuItem, type MenuState } from './ContextMenu'
import { dialog } from './Dialog'
import { Tooltip } from './Tooltip'
import { PickerMenu } from './PickerMenu'
import { activityWarning } from '../moveGuard'
import { ago } from './ActivityView'
import { addVaultFlow } from '../vaultActions'

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
  aiRunningCount: number
  git: GitState | null
  vaultPath: string
  vaults: VaultEntry[]
  activeVault: string
  width: number
  setView: (v: View) => void
  openDoc: (path: string) => void
  refresh: () => Promise<void>
  switchVault: (name: string) => Promise<void>
}

export function Sidebar(props: SidebarProps) {
  const { tree, queue, view, inboxCount, aiRunningCount, git, vaultPath, vaults, activeVault, width, setView, openDoc, refresh, switchVault } = props
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [lastClicked, setLastClicked] = useState<string | null>(null)
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({})
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [treeDropOver, setTreeDropOver] = useState(false)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [focusedPath, setFocusedPath] = useState<string | null>(null)
  const [vaultMenuOpen, setVaultMenuOpen] = useState(false)
  const dragDepth = useRef(0)
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const brandRef = useRef<HTMLButtonElement>(null)

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

  /** Visible rows (folders + docs) in display order — drives keyboard navigation. */
  const visibleRows = useMemo(() => {
    const out: Array<{ path: string; kind: 'folder' | 'doc' }> = []
    const walk = (node: TreeNode) => {
      for (const child of node.children ?? []) {
        out.push({ path: child.path, kind: child.kind })
        if (child.kind === 'folder' && isOpen(child.path)) walk(child)
      }
    }
    if (tree) walk(tree)
    return out
  }, [tree, isOpen])

  const absOf = (rel: string) => (vaultPath ? `${vaultPath}/${rel}` : rel)

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

  const destOf = (from: string, folder: string) => (folder ? `${folder}/${from.split('/').pop()}` : from.split('/').pop()!)

  const moveInternal = async (paths: string[], folder: string) => {
    const changed = paths.filter((from) => destOf(from, folder) !== from)
    if (changed.length === 0) return
    const warnings = (await Promise.all(changed.map((p) => activityWarning({ path: p })))).filter((w): w is string => !!w)
    const warning =
      warnings.length === 0
        ? undefined
        : warnings.length === 1
          ? warnings[0]
          : `${warnings.length} of these documents were written to recently by a Claude session — moving them will break that session's path references.`
    const res = await dialog.confirmOption({
      title: changed.length > 1 ? `Move ${changed.length} documents` : 'Move document',
      body: `Move to ${folder || 'vault root'}?`,
      warning,
      confirmLabel: 'Move',
      checkboxLabel: changed.length > 1 ? 'Leave symlinks at the old locations' : 'Leave a symlink at the old location',
      checkboxInitial: true,
    })
    if (!res.ok) return
    try {
      for (const from of changed) await api.move(from, destOf(from, folder), res.checked)
      setSelected(new Set())
      await refresh()
    } catch (e) {
      window.alert((e as Error).message)
    }
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
    const warning = await activityWarning({ folder: path })
    if (docs > 0) {
      const ok = await dialog.confirmTyped({
        title: 'Delete folder',
        body: `This deletes "${path}" and its ${docs} document(s). Type the folder name to confirm.`,
        warning,
        mustType: name,
        danger: true,
      })
      if (!ok) return
    } else {
      const ok = await dialog.confirm({ title: 'Delete empty folder?', body: `"${path}"`, warning, danger: true, confirmLabel: 'Delete' })
      if (!ok) return
    }
    try {
      await api.deleteFolder(path)
      await refresh()
    } catch (e) {
      window.alert((e as Error).message)
    }
  }

  const deleteSingleDoc = async (path: string) => {
    const ok = await dialog.confirm({
      title: 'Delete document?',
      body: `${path} — history stays in vault git.`,
      warning: await activityWarning({ path }),
      danger: true,
      confirmLabel: 'Delete',
    })
    if (ok) {
      try {
        await api.deleteDoc(path)
        await refresh()
      } catch (e) {
        window.alert((e as Error).message)
      }
    }
  }

  const deleteMultipleDocs = async (paths: string[]) => {
    const warnings = (await Promise.all(paths.map((p) => activityWarning({ path: p })))).filter((w): w is string => !!w)
    const warning =
      warnings.length === 0
        ? undefined
        : warnings.length === 1
          ? warnings[0]
          : `${warnings.length} of these documents were written to recently by a Claude session — deleting them will break that session's path references.`
    const ok = await dialog.confirm({
      title: `Delete ${paths.length} documents?`,
      body: 'History stays in vault git.',
      warning,
      danger: true,
      confirmLabel: 'Delete',
    })
    if (!ok) return
    try {
      for (const p of paths) await api.deleteDoc(p)
      setSelected(new Set())
      await refresh()
    } catch (e) {
      window.alert((e as Error).message)
    }
  }

  const docMenu = (path: string): MenuItem[] => {
    const multi = selected.has(path) && selected.size > 1
    if (multi) {
      const paths = [...selected]
      return [
        { label: `Add ${paths.length} to Up Next`, onClick: async () => { for (const p of paths) await api.queueAdd(p); await refresh() } },
        { label: `Copy ${paths.length} paths`, onClick: () => navigator.clipboard.writeText(paths.map(absOf).join('\n')) },
        { label: 'Move to folder…', onClick: async () => {
          const folder = await dialog.prompt({ title: 'Move to folder', label: 'Destination folder (empty = vault root)' })
          if (folder !== null) await moveInternal(paths, folder.trim().replace(/^\/+|\/+$/g, ''))
        } },
        { separator: true },
        { label: `Delete ${paths.length} documents…`, danger: true, onClick: () => deleteMultipleDocs(paths) },
      ]
    }
    return [
      { label: 'Open', onClick: () => openDoc(path) },
      { label: 'Add to Up Next', onClick: () => api.queueAdd(path).then(refresh) },
      { separator: true },
      { label: 'Rename / Move…', onClick: async () => {
        const res = await dialog.promptOption({
          title: 'Move / rename',
          label: 'New vault-relative path',
          initial: path,
          warning: await activityWarning({ path }),
          checkboxLabel: 'Leave a symlink at the old location',
          checkboxInitial: true,
        })
        if (res && res.value && res.value !== path) {
          try {
            await api.move(path, res.value, res.checked)
            await refresh()
            openDoc(res.value)
          } catch (e) {
            window.alert((e as Error).message)
          }
        }
      } },
      { label: 'Copy path', hint: 'vault', onClick: () => navigator.clipboard.writeText(path) },
      { label: 'Copy absolute path', onClick: () => navigator.clipboard.writeText(absOf(path)) },
      { label: 'Reveal in Finder', onClick: () => api.reveal({ path }) },
      { separator: true },
      { label: 'Delete…', danger: true, onClick: () => deleteSingleDoc(path) },
    ]
  }

  const folderMenu = (path: string): MenuItem[] => [
    { label: 'New subfolder…', onClick: async () => {
      const name = await dialog.prompt({ title: 'New subfolder', label: 'Subfolder name' })
      if (name?.trim()) { await api.createFolder(`${path}/${name.trim()}`); await refresh() }
    } },
    { label: 'Rename…', onClick: async () => {
      const name = await dialog.prompt({ title: 'Rename folder', label: 'New folder name', initial: path.split('/').pop() })
      if (!name?.trim()) return
      const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
      const to = parent ? `${parent}/${name.trim()}` : name.trim()
      if (to === path) return
      const res = await dialog.confirmOption({
        title: 'Rename folder',
        body: `"${path}" → "${to}"`,
        warning: await activityWarning({ folder: path }),
        confirmLabel: 'Rename',
        checkboxLabel: 'Leave a symlink at the old location',
        checkboxInitial: true,
      })
      if (!res.ok) return
      try {
        await api.renameFolder(path, to, res.checked)
        await refresh()
      } catch (e) {
        window.alert((e as Error).message)
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
      const name = await dialog.prompt({ title: 'New folder', label: 'Folder name (use / for nesting)' })
      if (name?.trim()) { await api.createFolder(name.trim()); await refresh() }
    } },
    { label: 'Scan for plans', onClick: async () => { await api.scan(); await refresh() } },
  ]

  // ----- vault switcher -----
  const vaultMenuOptions = [
    ...vaults.map((v) => ({ value: v.name, label: v.name })),
    { value: '__add__', label: '+ Add vault…' },
    { value: '__manage__', label: 'Manage vaults…' },
  ]

  const onVaultMenuSelect = async (value: string) => {
    if (value === '__add__') {
      if (await addVaultFlow()) await refresh()
      return
    }
    if (value === '__manage__') return setView({ kind: 'settings' })
    if (value !== activeVault) await switchVault(value)
  }

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

  // ----- tree keyboard navigation -----
  const focusRow = (path: string | null) => {
    setFocusedPath(path)
    if (path) rowRefs.current.get(path)?.scrollIntoView({ block: 'nearest' })
  }

  const onTreeKeyDown = (e: React.KeyboardEvent) => {
    if (visibleRows.length === 0) return
    const idx = focusedPath ? visibleRows.findIndex((r) => r.path === focusedPath) : -1
    const current = idx !== -1 ? visibleRows[idx] : null

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      focusRow(visibleRows[idx === -1 ? 0 : Math.min(idx + 1, visibleRows.length - 1)].path)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      focusRow(visibleRows[idx === -1 ? 0 : Math.max(idx - 1, 0)].path)
    } else if (e.key === 'ArrowRight') {
      if (!current || current.kind !== 'folder') return
      e.preventDefault()
      if (!isOpen(current.path)) {
        setOpenFolders({ ...openFolders, [current.path]: true })
      } else {
        const child = visibleRows[idx + 1]
        if (child && child.path.startsWith(current.path + '/')) focusRow(child.path)
      }
    } else if (e.key === 'ArrowLeft') {
      if (!current) return
      e.preventDefault()
      if (current.kind === 'folder' && isOpen(current.path)) {
        setOpenFolders({ ...openFolders, [current.path]: false })
      } else {
        const parent = current.path.includes('/') ? current.path.slice(0, current.path.lastIndexOf('/')) : null
        if (parent) focusRow(parent)
      }
    } else if (e.key === 'Enter') {
      if (!current) return
      e.preventDefault()
      if (current.kind === 'doc') {
        setSelected(new Set([current.path]))
        setLastClicked(current.path)
        openDoc(current.path)
      } else {
        setOpenFolders({ ...openFolders, [current.path]: !isOpen(current.path) })
      }
    } else if (e.key === ' ') {
      if (!current || current.kind !== 'doc') return
      e.preventDefault()
      const next = new Set(selected)
      next.has(current.path) ? next.delete(current.path) : next.add(current.path)
      setSelected(next)
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!current) return
      e.preventDefault()
      if (current.kind === 'doc') {
        if (selected.has(current.path) && selected.size > 1) void deleteMultipleDocs([...selected])
        else void deleteSingleDoc(current.path)
      } else {
        void confirmDeleteFolder(current.path)
      }
    }
  }

  const renderChildren = (node: TreeNode, depth: number): React.ReactNode =>
    node.children?.map((child) =>
      child.kind === 'folder' ? (
        <div key={child.path}>
          <div
            ref={(el) => { if (el) rowRefs.current.set(child.path, el); else rowRefs.current.delete(child.path) }}
            className={`tree-row folder-row${dropTarget === child.path ? ' drop-target' : ''}${focusedPath === child.path ? ' focused' : ''}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => { setFocusedPath(child.path); setOpenFolders({ ...openFolders, [child.path]: !isOpen(child.path) }) }}
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
          ref={(el) => { if (el) rowRefs.current.set(child.path, el); else rowRefs.current.delete(child.path) }}
          className={`tree-row doc-row${view.kind === 'doc' && view.path === child.path ? ' active' : ''}${selected.has(child.path) ? ' selected' : ''}${focusedPath === child.path ? ' focused' : ''} status-${child.doc!.meta.status}`}
          style={{ paddingLeft: 8 + depth * 14 + 14 }}
          draggable
          onDragStart={(e) => startDrag(child.path, e)}
          onClick={(e) => { setFocusedPath(child.path); handleDocClick(child.path, e) }}
          onContextMenu={(e) => {
            if (!selected.has(child.path)) setSelected(new Set([child.path]))
            showMenu(e, docMenu(child.path))
          }}
          title={child.path}
        >
          <span className="doc-glyph">{TYPE_ICONS[child.doc!.meta.type] ?? '≡'}</span>
          {child.doc!.meta.status === 'active' && <ActiveDot activity={child.doc!.claudeActivity} />}
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
      <button ref={brandRef} className="brand brand-switcher" onClick={() => setVaultMenuOpen((o) => !o)}>
        PlanKeep <span className="brand-vault">· {activeVault}</span> <span className="brand-chevron">▾</span>
      </button>
      {vaultMenuOpen && (
        <PickerMenu
          anchorRef={brandRef}
          options={vaultMenuOptions}
          current={activeVault}
          onSelect={onVaultMenuSelect}
          onClose={() => setVaultMenuOpen(false)}
        />
      )}

      <nav className="nav">
        <button className={`nav-item${view.kind === 'inbox' ? ' active' : ''}`} onClick={() => setView({ kind: 'inbox' })}>
          <span className="nav-glyph">▣</span> Inbox
          {inboxCount > 0 && <span className="badge">{inboxCount}</span>}
        </button>
        <button className={`nav-item${view.kind === 'activity' ? ' active' : ''}`} onClick={() => setView({ kind: 'activity' })}>
          <span className="nav-glyph">◷</span> Activity
          {aiRunningCount > 0 && <span className="badge running">{aiRunningCount}</span>}
        </button>
        <button
          className={`nav-item${view.kind === 'memories' || view.kind === 'memory' ? ' active' : ''}`}
          onClick={() => setView({ kind: 'memories' })}
        >
          <span className="nav-glyph">◈</span> Memories
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
                {d.meta.status === 'active' && <ActiveDot activity={d.claudeActivity} />}
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
          <Tooltip label="New folder">
            <button
              className="icon-btn"
              onClick={async () => {
                const name = await dialog.prompt({ title: 'New folder', label: 'Folder name (use / for nesting)' })
                if (name?.trim()) { await api.createFolder(name.trim()); await refresh() }
              }}
            >
              +
            </button>
          </Tooltip>
        </div>
        <div
          className="tree"
          tabIndex={0}
          onKeyDown={onTreeKeyDown}
          onClick={(e) => { if (e.target === e.currentTarget) setSelected(new Set()) }}
        >
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
        <Tooltip label="Git sync state — click for settings">
          <button className={`sync-pill ${syncState.cls}`} onClick={() => setView({ kind: 'settings' })}>
            <span className="sync-dot" /> {syncState.label}
          </button>
        </Tooltip>
        <Tooltip label="Settings">
          <button
            className={`icon-btn gear${view.kind === 'settings' ? ' active' : ''}`}
            onClick={() => setView({ kind: 'settings' })}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </Tooltip>
      </footer>

      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </aside>
  )
}

function ActiveDot({ activity }: { activity?: ClaudeActivity }) {
  const live = !!activity && Date.now() - Date.parse(activity.at) < 60 * 60 * 1000
  const label = live ? `Active — Claude session working on it ${ago(activity!.at)}` : 'Active'
  return (
    <Tooltip label={label}>
      <span className={`active-dot${live ? ' live' : ''}`} />
    </Tooltip>
  )
}
