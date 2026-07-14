import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api, type MemoryDoc, type MemoryProject } from '../api'
import type { View } from '../App'
import { CopyBtn } from './CopyBtn'

function ago(mtime: number): string {
  const sec = (Date.now() - mtime) / 1000
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`
  if (sec < 30 * 86400) return `${Math.round(sec / 86400)}d ago`
  return `${Math.round(sec / (30 * 86400))}mo ago`
}

interface MemoriesViewProps {
  view: View
  setView: (v: View) => void
}

export function MemoriesView({ view, setView }: MemoriesViewProps) {
  const [projects, setProjects] = useState<MemoryProject[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    api.memories().then(setProjects)
  }, [])

  // hash-restored memory views carry placeholder displayName/title (slug/file) — fill in the real labels once the project list loads
  useEffect(() => {
    if (view.kind !== 'memory' || projects.length === 0) return
    if (view.displayName !== view.slug || view.title !== view.file) return
    const project = projects.find((p) => p.slug === view.slug)
    const file = project?.files.find((f) => f.file === view.file)
    if (project && file && (project.displayName !== view.displayName || file.title !== view.title)) {
      setView({ ...view, displayName: project.displayName, title: file.title })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, projects])

  if (view.kind === 'memory') {
    return <MemoryDetail view={view} projects={projects} setView={setView} />
  }

  return (
    <div className="view">
      <h1>Memories</h1>
      <p className="hint">Claude Code's per-project memory — read-only here. Ask Claude to update it in a session.</p>
      {projects.length === 0 && <div className="empty-state">No Claude memory found under ~/.claude/projects.</div>}
      <div className="memories-list">
        {projects.map((p) => (
          <div key={p.slug} className="memory-project">
            <button className="memory-project-header" onClick={() => setExpanded(expanded === p.slug ? null : p.slug)}>
              <span className={`chevron${expanded === p.slug ? ' open' : ''}`}>›</span>
              <span className="row-label">{p.displayName}</span>
              <span className="row-count">{p.count}</span>
              <span className="memory-project-fresh">{ago(p.latestMtime)}</span>
            </button>
            {expanded === p.slug && (
              <div className="memory-file-list">
                {p.files.map((f) => (
                  <button
                    key={f.file}
                    className="memory-file-row"
                    onClick={() => setView({ kind: 'memory', slug: p.slug, file: f.file, displayName: p.displayName, title: f.title })}
                  >
                    <span className="memory-file-title">{f.title}</span>
                    <span className="memory-file-desc">{f.description}</span>
                    <span className="memory-file-time">{ago(f.mtime)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function MemoryDetail({
  view,
  projects,
  setView,
}: {
  view: Extract<View, { kind: 'memory' }>
  projects: MemoryProject[]
  setView: (v: View) => void
}) {
  const [doc, setDoc] = useState<MemoryDoc | null>(null)

  useEffect(() => {
    setDoc(null)
    api.memoryDoc(view.slug, view.file).then(setDoc)
  }, [view.slug, view.file])

  const siblingFiles = projects.find((p) => p.slug === view.slug)?.files ?? []

  if (!doc) return <div className="empty-state">Loading…</div>

  // [[name]] wiki-links: resolve against sibling memory files (by filename or title/frontmatter name),
  // turning matches into a custom-scheme markdown link; non-matches render as plain text.
  const body = doc.body.replace(/\[\[([a-z0-9-]+)\]\]/gi, (match, name) => {
    const target = siblingFiles.find((f) => f.file.replace(/\.md$/, '') === name || f.title === name)
    return target ? `[${name}](memory:${encodeURIComponent(target.file)})` : name
  })

  return (
    <div className="view">
      <button className="icon-btn memories-back" onClick={() => setView({ kind: 'memories' })}>← All memories</button>
      <h1>{view.title}</h1>
      <div className="banner">
        <span className="banner-body">Claude's memory — read-only here; ask Claude to update it.</span>
      </div>
      {Object.keys(doc.frontmatter).length > 0 && (
        <div className="memory-frontmatter">
          {Object.entries(doc.frontmatter).map(([k, v]) => (
            <div key={k} className="prop-row">
              <label>{k}</label>
              <span className="memory-fm-value">{typeof v === 'string' ? v : JSON.stringify(v)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="memory-actions">
        <span className="path-row-value">{doc.absPath}</span>
        <CopyBtn value={doc.absPath} />
        <button className="panel-btn" onClick={() => api.reveal({ absPath: doc.absPath })}>Reveal in Finder</button>
      </div>
      <article className="markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) => {
              if (href?.startsWith('memory:')) {
                const file = decodeURIComponent(href.slice('memory:'.length))
                const target = siblingFiles.find((f) => f.file === file)
                return (
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault()
                      if (target) setView({ kind: 'memory', slug: view.slug, file: target.file, displayName: view.displayName, title: target.title })
                    }}
                  >
                    {children}
                  </a>
                )
              }
              return (
                <a href={href} target="_blank" rel="noreferrer">
                  {children}
                </a>
              )
            },
          }}
        >
          {body}
        </ReactMarkdown>
      </article>
    </div>
  )
}
