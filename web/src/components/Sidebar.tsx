import { useState } from 'react'
import { api, type GitState, type TreeNode } from '../api'
import type { View } from '../App'

const TYPE_ICONS: Record<string, string> = {
  plan: '📋',
  findings: '🔍',
  exploration: '🧭',
  research: '📚',
  note: '📝',
}

interface SidebarProps {
  tree: TreeNode | null
  view: View
  inboxCount: number
  git: GitState | null
  setView: (v: View) => void
  openDoc: (path: string) => void
  refresh: () => Promise<void>
}

export function Sidebar({ tree, view, inboxCount, git, setView, openDoc, refresh }: SidebarProps) {
  const newFolder = async () => {
    const name = window.prompt('New folder name (use / for nesting):')
    if (name?.trim()) {
      await api.createFolder(name.trim())
      await refresh()
    }
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-name">PlanKeep</span>
        <button className="icon-btn" title="New folder" onClick={newFolder}>
          ＋📁
        </button>
      </div>
      <nav className="nav">
        <NavItem active={view.kind === 'queue'} onClick={() => setView({ kind: 'queue' })} label="⏭️ Up Next" />
        <NavItem
          active={view.kind === 'inbox'}
          onClick={() => setView({ kind: 'inbox' })}
          label="📥 Inbox"
          badge={inboxCount || undefined}
        />
        <NavItem active={view.kind === 'search'} onClick={() => setView({ kind: 'search' })} label="🔎 Search" />
        <NavItem active={view.kind === 'settings'} onClick={() => setView({ kind: 'settings' })} label="⚙️ Settings" />
      </nav>
      <div className="tree">
        {tree?.children?.length ? (
          <FolderChildren node={tree} view={view} openDoc={openDoc} refresh={refresh} />
        ) : (
          <div className="tree-empty">Vault is empty — import docs via the Inbox, drag files here, or let Claude save plans through MCP.</div>
        )}
        <DropZone folder="" refresh={refresh} label="⤵ Drop .md files here to import to vault root" />
      </div>
      {git && (
        <button className="git-chip" onClick={() => setView({ kind: 'settings' })} title="Git status — click for settings">
          {git.conflicted ? '⚠️ conflicted' : git.lastError ? '⚠️ sync error' : '🌿'} {git.branch}
          {git.dirty > 0 && ` · ${git.dirty} dirty`}
          {git.ahead > 0 && ` · ↑${git.ahead}`}
          {git.behind > 0 && ` · ↓${git.behind}`}
          {!git.remote && ' · no remote'}
        </button>
      )}
    </aside>
  )
}

function NavItem({ active, onClick, label, badge }: { active: boolean; onClick: () => void; label: string; badge?: number }) {
  return (
    <button className={`nav-item${active ? ' active' : ''}`} onClick={onClick}>
      {label}
      {badge !== undefined && <span className="badge">{badge}</span>}
    </button>
  )
}

function useDropHandlers(folder: string, refresh: () => Promise<void>) {
  const [over, setOver] = useState(false)
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setOver(true)
  }
  const onDragLeave = () => setOver(false)
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setOver(false)
    const docPath = e.dataTransfer.getData('application/x-plankeep-path')
    if (docPath) {
      const name = docPath.split('/').pop()!
      const to = folder ? `${folder}/${name}` : name
      if (to !== docPath) await api.move(docPath, to)
    } else {
      for (const file of Array.from(e.dataTransfer.files)) {
        if (!file.name.endsWith('.md')) continue
        const content = await file.text()
        await api.importContent(file.name, content, folder)
      }
    }
    await refresh()
  }
  return { over, onDragOver, onDragLeave, onDrop }
}

function FolderChildren({ node, view, openDoc, refresh }: { node: TreeNode; view: View; openDoc: (p: string) => void; refresh: () => Promise<void> }) {
  return (
    <>
      {node.children?.map((child) =>
        child.kind === 'folder' ? (
          <FolderNode key={child.path} node={child} view={view} openDoc={openDoc} refresh={refresh} />
        ) : (
          <DocNode key={child.path} node={child} view={view} openDoc={openDoc} />
        ),
      )}
    </>
  )
}

function FolderNode({ node, view, openDoc, refresh }: { node: TreeNode; view: View; openDoc: (p: string) => void; refresh: () => Promise<void> }) {
  const [open, setOpen] = useState(true)
  const drop = useDropHandlers(node.path, refresh)
  const docCount = node.children?.filter((c) => c.kind === 'doc').length ?? 0

  const del = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (window.confirm(`Delete folder "${node.path}" and everything in it?`)) {
      await api.deleteFolder(node.path)
      await refresh()
    }
  }

  return (
    <div className={`folder${drop.over ? ' drop-over' : ''}`} onDragOver={drop.onDragOver} onDragLeave={drop.onDragLeave} onDrop={drop.onDrop}>
      <div className="folder-row" onClick={() => setOpen(!open)}>
        <span>{open ? '▾' : '▸'} 📁 {node.name}</span>
        <span className="folder-actions">
          <span className="count">{docCount || ''}</span>
          <button className="icon-btn danger" title="Delete folder" onClick={del}>
            ✕
          </button>
        </span>
      </div>
      {open && (
        <div className="folder-children">
          <FolderChildren node={node} view={view} openDoc={openDoc} refresh={refresh} />
        </div>
      )}
    </div>
  )
}

function DocNode({ node, view, openDoc }: { node: TreeNode; view: View; openDoc: (p: string) => void }) {
  const doc = node.doc!
  const active = view.kind === 'doc' && view.path === node.path
  const { done, total } = doc.progress
  return (
    <div
      className={`doc-row${active ? ' active' : ''} status-${doc.meta.status}`}
      draggable
      onDragStart={(e) => e.dataTransfer.setData('application/x-plankeep-path', node.path)}
      onClick={() => openDoc(node.path)}
      title={node.path}
    >
      <span className="doc-icon">{TYPE_ICONS[doc.meta.type] ?? '📝'}</span>
      <span className="doc-title">{doc.title}</span>
      {total > 0 && (
        <span className={`progress-pill${done === total ? ' complete' : ''}`}>
          {done}/{total}
        </span>
      )}
    </div>
  )
}

function DropZone({ folder, refresh, label }: { folder: string; refresh: () => Promise<void>; label: string }) {
  const drop = useDropHandlers(folder, refresh)
  return (
    <div className={`drop-zone${drop.over ? ' drop-over' : ''}`} onDragOver={drop.onDragOver} onDragLeave={drop.onDragLeave} onDrop={drop.onDrop}>
      {label}
    </div>
  )
}
