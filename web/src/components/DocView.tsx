import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api, type AiJob, type ClaudeActivity, type Config, type FullDoc } from '../api'
import { CopyBtn } from './CopyBtn'
import { dialog } from './Dialog'
import { Tooltip } from './Tooltip'
import { PickerMenu } from './PickerMenu'
import { LabelsEditor } from './LabelsEditor'
import { ACTION_LABELS, ago } from './ActivityView'
import { OutlineNav, type OutlineItem } from './OutlineNav'
import type { DocApi } from '../shortcuts'
import { activityWarning } from '../moveGuard'

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
  onPanelCollapsedChange?: (collapsed: boolean) => void
}

export function DocView({ path, config, refresh, onDeleted, onMoved, onDocApi, onOpenActivity, onPanelCollapsedChange }: DocViewProps) {
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
  const articleRef = useRef<HTMLElement>(null)
  const [outline, setOutline] = useState<OutlineItem[]>([])
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null)
  const [outlinePinned, setOutlinePinned] = useState(() => localStorage.getItem('pk-outline-pinned') === '1')
  const [panelCollapsed, setPanelCollapsed] = useState(() => localStorage.getItem('pk-doc-panel-collapsed') === '1')

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

  useEffect(() => {
    localStorage.setItem('pk-outline-pinned', outlinePinned ? '1' : '0')
  }, [outlinePinned])

  useEffect(() => {
    localStorage.setItem('pk-doc-panel-collapsed', panelCollapsed ? '1' : '0')
    onPanelCollapsedChange?.(panelCollapsed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelCollapsed])

  // heading extraction — DOM-based so it always matches what ReactMarkdown rendered
  useEffect(() => {
    if (editing || !doc) {
      setOutline([])
      return
    }
    const el = articleRef.current
    if (!el) return
    const headings = Array.from(el.querySelectorAll('h1, h2, h3, h4'))
    const title = doc.title.trim().toLowerCase()
    let skippedTitleH1 = false
    const items: OutlineItem[] = []
    headings.forEach((h, i) => {
      const text = (h.textContent ?? '').trim()
      if (!skippedTitleH1 && h.tagName === 'H1' && text.toLowerCase() === title) {
        skippedTitleH1 = true
        return
      }
      const id = `pk-h-${i}`
      h.id = id
      items.push({ id, depth: Number(h.tagName[1]), text: text.length > 60 ? `${text.slice(0, 60)}…` : text })
    })
    setOutline(items)
    setActiveHeadingId(items[0]?.id ?? null)
  }, [doc, editing])

  // scroll-spy over the .doc-main scroll container
  useEffect(() => {
    if (outline.length === 0) return
    const container = articleRef.current?.closest('.doc-main') as HTMLElement | null
    if (!container) return
    let ticking = false
    const compute = () => {
      ticking = false
      const threshold = container.getBoundingClientRect().top + 96
      let current: string | null = outline[0]?.id ?? null
      for (const item of outline) {
        const el = document.getElementById(item.id)
        if (!el) continue
        if (el.getBoundingClientRect().top <= threshold) current = item.id
        else break
      }
      setActiveHeadingId(current)
    }
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(compute)
    }
    compute()
    container.addEventListener('scroll', onScroll)
    return () => container.removeEventListener('scroll', onScroll)
  }, [outline])

  const navigateToHeading = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

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
    const res = await dialog.promptOption({
      title: 'Move / rename',
      label: 'Vault-relative path',
      initial: path,
      warning: await activityWarning({ path }),
      checkboxLabel: 'Leave a symlink at the old location',
      checkboxInitial: true,
    })
    if (res && res.value && res.value !== path) {
      try {
        await api.move(path, res.value, res.checked)
        await refresh()
        onMoved(res.value)
      } catch (e) {
        window.alert((e as Error).message)
      }
    }
  }

  const del = async () => {
    const ok = await dialog.confirm({
      title: 'Delete document?',
      body: `${path} — previous versions stay in vault git history.`,
      warning: await activityWarning({ path }),
      danger: true,
      confirmLabel: 'Delete',
    })
    if (ok) {
      try {
        await api.deleteDoc(path)
        await refresh()
        onDeleted()
      } catch (e) {
        window.alert((e as Error).message)
      }
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
      toggleOutline: () => setOutlinePinned((p) => !p),
      togglePanel: () => setPanelCollapsed((p) => !p),
    })
    return () => onDocApi(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, path, enterEdit, exitEditRequest])

  if (error) return <div className="empty-state">Could not open {path}: {error}</div>
  if (!doc) return <div className="empty-state">Loading…</div>

  let checkboxIndex = -1

  return (
    <div className="doc-layout">
      {!editing && outline.length >= 2 && (
        <OutlineNav
          items={outline}
          activeId={activeHeadingId}
          onNavigate={navigateToHeading}
          pinned={outlinePinned}
          onPinnedChange={setOutlinePinned}
        />
      )}
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
            <span className="type-label" title={new Date(doc.mtime).toLocaleString()}>
              edited {ago(new Date(doc.mtime).toISOString())}
            </span>
            {doc.claudeActivity && <ClaudeActivityBadge activity={doc.claudeActivity} />}
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
          <article className="markdown" ref={articleRef}>
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

      {panelCollapsed ? (
        <Tooltip label="Show panel" keys="]">
          <button className="doc-panel-rail" onClick={() => setPanelCollapsed(false)}>
            «
          </button>
        </Tooltip>
      ) : (
      <aside className="doc-panel">
        <div className="doc-panel-top">
          <Tooltip label="Hide panel" keys="]">
            <button className="icon-btn" onClick={() => setPanelCollapsed(true)}>
              »
            </button>
          </Tooltip>
        </div>
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
      )}
    </div>
  )
}

function ClaudeActivityBadge({ activity }: { activity: ClaudeActivity }) {
  const [copied, setCopied] = useState(false)
  const live = Date.now() - Date.parse(activity.at) < 60 * 60 * 1000

  if (!activity.sessionId) {
    return <span className="type-label">· Claude write {ago(activity.at)}</span>
  }

  const badge = (
    <span
      className="type-label session-badge"
      onClick={() => {
        navigator.clipboard.writeText(activity.sessionId!)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
    >
      {live && <span className="active-dot live" />}
      {copied ? 'copied ✓' : `· Claude session ${activity.sessionId.slice(0, 8)} ${ago(activity.at)}`}
    </span>
  )

  return (
    <Tooltip label={`Session ${activity.sessionId}${activity.cwd ? ` · ${activity.cwd}` : ''} — click to copy id`}>
      {badge}
    </Tooltip>
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
