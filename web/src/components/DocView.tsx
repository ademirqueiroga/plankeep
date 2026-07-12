import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api, type AiJob, type Config, type FullDoc } from '../api'
import { CopyBtn } from './CopyBtn'
import { dialog } from './Dialog'
import { Tooltip } from './Tooltip'
import { PickerMenu } from './PickerMenu'
import { LabelsEditor } from './LabelsEditor'
import { ACTION_LABELS, ago } from './ActivityView'
import type { DocApi } from '../shortcuts'

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
  onDocApi?: (api: DocApi | null) => void
  onOpenActivity: () => void
}

export function DocView({ path, config, refresh, onDeleted, onMoved, onDocApi, onOpenActivity }: DocViewProps) {
  const [doc, setDoc] = useState<FullDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [aiJob, setAiJob] = useState<{ id: string; action: string } | null>(null)
  const [aiMessage, setAiMessage] = useState<string | null>(null)
  const [lastRun, setLastRun] = useState<AiJob | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState<'status' | 'type' | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const statusBtnRef = useRef<HTMLButtonElement>(null)
  const typeBtnRef = useRef<HTMLButtonElement>(null)
  const tagsInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const d = await api.doc(path)
      setDoc(d)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [path])

  const loadLastRun = useCallback(async () => {
    const jobs = await api.aiJobs()
    const mine = jobs.filter((j) => j.path === path).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    setLastRun(mine[0] ?? null)
  }, [path])

  useEffect(() => {
    load()
    loadLastRun()
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [load, loadLastRun])

  const toggleCheckbox = async (n: number) => {
    if (!doc) return
    const body = toggleNthCheckbox(doc.body, n)
    const prevStatus = doc.meta.status
    setDoc({ ...doc, body })
    const summary = await api.saveBody(path, body)
    await load()
    await refresh()
    if (summary.meta.status !== prevStatus) {
      setStatusMessage(
        summary.meta.status === 'done' ? 'All tasks complete — status set to done.' : 'Task unchecked — status set back to active.',
      )
    }
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
        await loadLastRun()
      }
    }, 3000)
  }

  const rename = async () => {
    const to = await dialog.prompt({ title: 'Move / rename', label: 'Vault-relative path', initial: path })
    if (to && to !== path) {
      await api.move(path, to)
      await refresh()
      onMoved(to)
    }
  }

  const del = async () => {
    const ok = await dialog.confirm({
      title: 'Delete document?',
      body: `${path} — previous versions stay in vault git history.`,
      danger: true,
      confirmLabel: 'Delete',
    })
    if (ok) {
      await api.deleteDoc(path)
      await refresh()
      onDeleted()
    }
  }

  const enterEdit = useCallback(() => {
    if (!doc) return
    setDraft(doc.content)
    setEditing(true)
  }, [doc])

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(0, 0)
    }
  }, [editing])

  const saveEdit = async () => {
    await api.saveDoc(path, draft)
    setEditing(false)
    await load()
    await refresh()
  }

  const exitEditRequest = useCallback(async () => {
    if (!doc) return
    if (draft === doc.content) {
      setEditing(false)
      return
    }
    const choice = await dialog.saveDiscard({ title: 'Unsaved changes', body: `Save your edits to ${doc.title}?` })
    if (choice === 'save') await saveEdit()
    else if (choice === 'discard') setEditing(false)
    // 'cancel' — stay in the editor
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, draft, path])

  useEffect(() => {
    if (!onDocApi) return
    onDocApi({
      enterEdit,
      exitEditRequest,
      openStatusPicker: () => setPickerOpen('status'),
      openTypePicker: () => setPickerOpen('type'),
      focusLabels: () => tagsInputRef.current?.focus(),
      copyVaultPath: () => navigator.clipboard.writeText(path),
      copyAbsPath: () => doc && navigator.clipboard.writeText(doc.absPath),
      copyMention: () => doc && navigator.clipboard.writeText(`@${doc.absPath}`),
      runAi: (action: string) => runAi(action),
      del,
      rename,
      addToQueue: () => api.queueAdd(path).then(refresh),
    })
    return () => onDocApi(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, path, enterEdit, exitEditRequest])

  if (error) return <div className="empty-state">Could not open {path}: {error}</div>
  if (!doc) return <div className="empty-state">Loading…</div>

  let checkboxIndex = -1

  return (
    <div className="doc-layout">
      <div className="doc-main">
        {(aiJob || aiMessage) && (
          <div className={`banner${aiMessage?.includes('failed') ? ' error' : ''}`}>
            <span className="banner-body">
              {aiJob ? `Running AI ${aiJob.action} via claude -p — this can take a few minutes…` : aiMessage}
            </span>
            <span className="banner-actions">
              <button className="icon-btn" onClick={onOpenActivity}>View activity</button>
              {aiMessage && <button className="icon-btn" onClick={() => setAiMessage(null)}>✕</button>}
            </span>
          </div>
        )}
        {statusMessage && (
          <div className="banner">
            <span className="banner-body">{statusMessage}</span>
            <button className="icon-btn" onClick={() => setStatusMessage(null)}>✕</button>
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
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  exitEditRequest()
                }
              }}
              spellCheck={false}
            />
            <div className="editor-actions">
              <button className="primary" onClick={saveEdit}>Save</button>
              <button onClick={exitEditRequest}>Cancel</button>
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
            <button ref={typeBtnRef} className="prop-value-btn" onClick={() => setPickerOpen('type')}>{doc.meta.type}</button>
          </div>
          <div className="prop-row">
            <label>Status</label>
            <button ref={statusBtnRef} className={`prop-value-btn status-pill s-${doc.meta.status}`} onClick={() => setPickerOpen('status')}>
              {doc.meta.status}
            </button>
          </div>
          <div className="prop-row">
            <label>Labels</label>
            <LabelsEditor value={doc.meta.tags} onChange={(tags) => setMeta({ tags })} inputRef={tagsInputRef} />
          </div>
        </PanelGroup>

        {pickerOpen === 'type' && (
          <PickerMenu
            anchorRef={typeBtnRef}
            options={TYPES.map((t) => ({ value: t, label: t }))}
            current={doc.meta.type}
            onSelect={(v) => setMeta({ type: v })}
            onClose={() => setPickerOpen(null)}
          />
        )}
        {pickerOpen === 'status' && (
          <PickerMenu
            anchorRef={statusBtnRef}
            options={STATUSES.map((s) => ({ value: s, label: s }))}
            current={doc.meta.status}
            onSelect={(v) => setMeta({ status: v })}
            onClose={() => setPickerOpen(null)}
          />
        )}

        <PanelGroup title="Actions">
          <Tooltip label="Add to Up Next">
            <button className="panel-btn" onClick={() => api.queueAdd(path).then(refresh)}>Add to Up Next</button>
          </Tooltip>
          <Tooltip label={editing ? 'View rendered' : 'Edit markdown'} keys={editing ? undefined : 'E'}>
            <button className="panel-btn" onClick={() => (editing ? exitEditRequest() : enterEdit())}>
              {editing ? 'View rendered' : 'Edit markdown'}
            </button>
          </Tooltip>
          <button className="panel-btn" onClick={rename}>Move / rename…</button>
          <button className="panel-btn" onClick={() => api.reveal({ path })}>Reveal in Finder</button>
        </PanelGroup>

        <PanelGroup title="AI">
          {AI_ACTIONS.map((a) => (
            <Tooltip key={a.id} label={a.hint}>
              <button className="panel-btn" disabled={!!aiJob} onClick={() => runAi(a.id)}>
                {aiJob?.action === a.id ? 'Running…' : a.label}
              </button>
            </Tooltip>
          ))}
          {lastRun && (
            <button className="panel-hint-link" onClick={onOpenActivity}>
              Last run: {ACTION_LABELS[lastRun.action] ?? lastRun.action} — {lastRun.status} {ago(lastRun.startedAt)}
            </button>
          )}
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
