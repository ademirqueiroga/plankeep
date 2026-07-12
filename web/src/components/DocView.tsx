import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api, type Config, type FullDoc } from '../api'
import { CopyBtn } from './CopyBtn'

const TYPES = ['plan', 'findings', 'exploration', 'research', 'note'] as const
const STATUSES = ['draft', 'active', 'done', 'archived'] as const
const AI_ACTIONS = [
  { id: 'improve', label: 'Improve readability', hint: 'Rewrite for clarity, keep all information' },
  { id: 'checkboxify', label: 'Add checkboxes', hint: 'Turn phases/steps into task lists' },
  { id: 'refresh', label: 'Refresh vs repo', hint: 'Cross-check against the source repository' },
] as const

const CHECKBOX_RE = /(^[ \t]*[-*+][ \t]+\[)( |x|X)(\])/gm

function toggleNthCheckbox(body: string, n: number): string {
  let i = -1
  return body.replace(CHECKBOX_RE, (match, pre, state, post) => {
    i++
    if (i !== n) return match
    return `${pre}${state.toLowerCase() === 'x' ? ' ' : 'x'}${post}`
  })
}

interface DocViewProps {
  path: string
  config: Config | null
  refresh: () => Promise<void>
  onDeleted: () => void
  onMoved: (newPath: string) => void
}

export function DocView({ path, config, refresh, onDeleted, onMoved }: DocViewProps) {
  const [doc, setDoc] = useState<FullDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [aiJob, setAiJob] = useState<{ id: string; action: string } | null>(null)
  const [aiMessage, setAiMessage] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await api.doc(path)
      setDoc(d)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [path])

  useEffect(() => {
    load()
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [load])

  const toggleCheckbox = async (n: number) => {
    if (!doc) return
    const body = toggleNthCheckbox(doc.body, n)
    setDoc({ ...doc, body })
    await api.saveBody(path, body)
    await load()
    await refresh()
  }

  const setMeta = async (patch: Record<string, unknown>) => {
    await api.setMeta(path, patch)
    await load()
    await refresh()
  }

  const runAi = async (action: string) => {
    setAiMessage(null)
    const job = await api.aiRun(path, action)
    setAiJob({ id: job.id, action })
    pollRef.current = setInterval(async () => {
      const j = await api.aiJob(job.id)
      if (j.status !== 'running') {
        if (pollRef.current) clearInterval(pollRef.current)
        setAiJob(null)
        setAiMessage(j.status === 'done' ? `AI ${action} finished — document updated and committed.` : `AI ${action} failed: ${j.error}`)
        await load()
        await refresh()
      }
    }, 3000)
  }

  const rename = async () => {
    const to = window.prompt('Move/rename (vault-relative path):', path)
    if (to && to !== path) {
      await api.move(path, to)
      await refresh()
      onMoved(to)
    }
  }

  const del = async () => {
    if (window.confirm(`Delete ${path}? (previous versions stay in vault git history)`)) {
      await api.deleteDoc(path)
      await refresh()
      onDeleted()
    }
  }

  if (error) return <div className="empty-state">Could not open {path}: {error}</div>
  if (!doc) return <div className="empty-state">Loading…</div>

  let checkboxIndex = -1

  return (
    <div className="doc-layout">
      <div className="doc-main">
        {(aiJob || aiMessage) && (
          <div className={`banner${aiMessage?.includes('failed') ? ' error' : ''}`}>
            {aiJob ? `Running AI ${aiJob.action} via claude -p — this can take a few minutes…` : aiMessage}
            {aiMessage && <button className="icon-btn" onClick={() => setAiMessage(null)}>✕</button>}
          </div>
        )}
        <div className="doc-title-block">
          <h1 className="doc-title-serif">{doc.title}</h1>
          <div className="doc-subtitle">
            <span className={`status-pill s-${doc.meta.status}`}>{doc.meta.status}</span>
            <span className="type-label">{doc.meta.type}</span>
            {doc.meta.source?.project && <span className="type-label">from {doc.meta.source.project}</span>}
          </div>
        </div>

        {editing ? (
          <div className="editor">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
            <div className="editor-actions">
              <button
                className="primary"
                onClick={async () => {
                  await api.saveDoc(path, draft)
                  setEditing(false)
                  await load()
                  await refresh()
                }}
              >
                Save
              </button>
              <button onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <article className="markdown">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                input: (props) => {
                  if (props.type !== 'checkbox') return <input {...props} />
                  checkboxIndex++
                  const n = checkboxIndex
                  return <input type="checkbox" checked={props.checked ?? false} disabled={false} onChange={() => toggleCheckbox(n)} />
                },
              }}
            >
              {doc.body}
            </ReactMarkdown>
          </article>
        )}
      </div>

      <aside className="doc-panel">
        <PanelGroup title="Properties">
          <div className="prop-row">
            <label>Type</label>
            <select value={doc.meta.type} onChange={(e) => setMeta({ type: e.target.value })}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="prop-row">
            <label>Status</label>
            <select value={doc.meta.status} onChange={(e) => setMeta({ status: e.target.value })}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="prop-row">
            <label>Tags</label>
            <input
              defaultValue={doc.meta.tags.join(', ')}
              placeholder="comma, separated"
              onBlur={(e) => {
                const tags = e.target.value.split(',').map((t) => t.trim()).filter(Boolean)
                if (tags.join(',') !== doc.meta.tags.join(',')) setMeta({ tags })
              }}
            />
          </div>
        </PanelGroup>

        <PanelGroup title="Actions">
          <button className="panel-btn" onClick={() => api.queueAdd(path).then(refresh)}>Add to Up Next</button>
          <button className="panel-btn" onClick={() => { setDraft(doc.content); setEditing(!editing) }}>
            {editing ? 'View rendered' : 'Edit markdown'}
          </button>
          <button className="panel-btn" onClick={rename}>Move / rename…</button>
          <button className="panel-btn" onClick={() => api.reveal({ path })}>Reveal in Finder</button>
        </PanelGroup>

        <PanelGroup title="AI">
          {AI_ACTIONS.map((a) => (
            <button key={a.id} className="panel-btn" disabled={!!aiJob} title={a.hint} onClick={() => runAi(a.id)}>
              {aiJob?.action === a.id ? 'Running…' : a.label}
            </button>
          ))}
        </PanelGroup>

        <PanelGroup title="Paths">
          <PathRow label="Vault" value={path} />
          <PathRow label="Absolute" value={doc.absPath} />
          <PathRow label="@mention" value={`@${doc.absPath}`} />
          {doc.meta.source?.path && <PathRow label="Source" value={doc.meta.source.path} />}
        </PanelGroup>

        <PanelGroup title="Danger">
          <button className="panel-btn danger" onClick={del}>Delete document…</button>
        </PanelGroup>
      </aside>
    </div>
  )
}

function PanelGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel-group">
      <div className="panel-group-title">{title}</div>
      {children}
    </div>
  )
}

function PathRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="path-row" title={value}>
      <span className="path-row-label">{label}</span>
      <span className="path-row-value">{value}</span>
      <CopyBtn value={value} />
    </div>
  )
}
