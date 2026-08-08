import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api, downloadPdf, type AiJob, type ClaudeActivity, type Config, type DocMeta, type DocSummary, type FullDoc } from '../api'
import { CopyBtn } from './CopyBtn'
import { dialog } from './Dialog'
import { Tooltip } from './Tooltip'
import { PickerMenu } from './PickerMenu'
import { LabelsEditor } from './LabelsEditor'
import { ACTION_LABELS, ago } from './ActivityView'
import { OutlineNav, type OutlineItem } from './OutlineNav'
import type { DocApi } from '../shortcuts'
import { activityWarning } from '../moveGuard'
import { createsCycle } from '../treeOrder'

const TYPES = ['plan', 'findings', 'exploration', 'research', 'note'] as const
const STATUSES = ['draft', 'active', 'waiting', 'done', 'archived'] as const
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

function countUnchecked(body: string): number {
  let n = 0
  for (const m of body.matchAll(CHECKBOX_RE)) {
    if (m[2].toLowerCase() !== 'x') n++
  }
  return n
}

interface DocViewProps {
  path: string
  config: Config | null
  refresh: () => Promise<void>
  onDeleted: () => void
  onMoved: (newPath: string) => void
  openDoc: (path: string) => void
  onDocApi?: (api: DocApi | null) => void
  onOpenActivity: () => void
  onPanelCollapsedChange?: (collapsed: boolean) => void
}

export function DocView({ path, config, refresh, onDeleted, onMoved, openDoc, onDocApi, onOpenActivity, onPanelCollapsedChange }: DocViewProps) {
  const [doc, setDoc] = useState<FullDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [aiJob, setAiJob] = useState<{ id: string; action: string } | null>(null)
  const [aiMessage, setAiMessage] = useState<string | null>(null)
  const [lastRun, setLastRun] = useState<AiJob | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [pickerOpen, setPickerOpen] = useState<'status' | 'type' | 'parent' | null>(null)
  const [allDocs, setAllDocs] = useState<DocSummary[]>([])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const savingRef = useRef(false)
  const pendingReloadOnExitRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const statusBtnRef = useRef<HTMLButtonElement>(null)
  const typeBtnRef = useRef<HTMLButtonElement>(null)
  const parentBtnRef = useRef<HTMLButtonElement>(null)
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

  // re-check the file on disk so the doc updates without a manual refresh — the whole reason people used to hit ⌘R
  const maybeReload = useCallback(async () => {
    if (editing) {
      pendingReloadOnExitRef.current = true // catch up once the editor closes, instead of clobbering it now
      return
    }
    if (savingRef.current) return // in-flight checkbox/save — its own load() call will pick up the fresh mtime
    const fresh = await api.doc(path)
    setDoc((cur) => (cur && fresh.mtime === cur.mtime ? cur : fresh))
  }, [path, editing])

  const maybeReloadRef = useRef(maybeReload)
  useEffect(() => {
    maybeReloadRef.current = maybeReload
  }, [maybeReload])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void maybeReloadRef.current()
    }
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    const interval = setInterval(() => void maybeReloadRef.current(), 15_000)
    return () => {
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(interval)
    }
  }, [])

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

  // scroll memory is per-tab-session (not localStorage): a plan reopened days later should start at the top,
  // but a refresh mid-read shouldn't lose your place
  const scrollRestoredRef = useRef(false)
  useEffect(() => {
    if (scrollRestoredRef.current || editing || !doc) return
    const container = articleRef.current?.closest('.doc-main') as HTMLElement | null
    if (!container) return
    scrollRestoredRef.current = true
    const saved = sessionStorage.getItem(`pk-scroll:${path}`)
    if (!saved) return
    requestAnimationFrame(() => {
      container.scrollTop = Number(saved)
    })
  }, [doc, editing, path])

  // scroll-spy over the .doc-main scroll container, piggybacking the same listener to persist scroll position
  useEffect(() => {
    const container = articleRef.current?.closest('.doc-main') as HTMLElement | null
    if (!container) return
    let ticking = false
    const computeSpy = () => {
      if (outline.length === 0) return
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
      requestAnimationFrame(() => {
        ticking = false
        computeSpy()
        sessionStorage.setItem(`pk-scroll:${path}`, String(container.scrollTop))
      })
    }
    computeSpy() // establish the initial active heading only — no sessionStorage write until a real scroll happens
    container.addEventListener('scroll', onScroll)
    return () => container.removeEventListener('scroll', onScroll)
  }, [outline, path])

  const navigateToHeading = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const toggleCheckbox = async (n: number) => {
    if (!doc) return
    const body = toggleNthCheckbox(doc.body, n)
    const prevStatus = doc.meta.status
    setDoc({ ...doc, body })
    savingRef.current = true
    try {
      const summary = await api.saveBody(path, body)
      await load()
      await refresh()
      if (summary.meta.status !== prevStatus) {
        setStatusMessage(
          summary.meta.status === 'done' ? 'All tasks complete — status set to done.' : 'Task unchecked — status set back to active.',
        )
      }
    } finally {
      savingRef.current = false
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

  const openParentPicker = async () => {
    setAllDocs(await api.docs())
    setPickerOpen('parent')
  }

  const chooseParent = async (value: string) => {
    if (!doc) return
    if (!value) return setMeta({ derivedFrom: null })
    if (createsCycle(doc.meta.id, value, allDocs)) {
      setStatusMessage('That would create a cycle — a document cannot derive from itself or one of its own derived documents.')
      return
    }
    await setMeta({ derivedFrom: value })
  }

  const archive = async () => {
    await setMeta({ status: 'archived' })
    setStatusMessage('Archived — hidden from the vault tree and removed from Up Next.')
  }

  const exportPdf = async () => {
    setExporting(true)
    const res = await downloadPdf(path)
    setExporting(false)
    if (!res.ok) {
      setStatusMessage(res.fallback ? `${res.error} Opening the print dialog instead — choose "Save as PDF".` : res.error ?? 'Export failed.')
    }
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
    savingRef.current = true
    try {
      await api.saveDoc(path, draft)
      setEditing(false)
      await load()
      await refresh()
    } finally {
      savingRef.current = false
    }
    pendingReloadOnExitRef.current = false
  }

  const catchUpAfterEdit = () => {
    if (!pendingReloadOnExitRef.current) return
    pendingReloadOnExitRef.current = false
    load()
  }

  const exitEditRequest = useCallback(async () => {
    if (!doc) return
    if (draft === doc.content) {
      setEditing(false)
      catchUpAfterEdit()
      return
    }
    const choice = await dialog.saveDiscard({ title: 'Unsaved changes', body: `Save your edits to ${doc.title}?` })
    if (choice === 'save') await saveEdit()
    else if (choice === 'discard') {
      setEditing(false)
      catchUpAfterEdit()
    }
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
      archive,
      toggleOutline: () => setOutlinePinned((p) => !p),
      togglePanel: () => setPanelCollapsed((p) => !p),
    })
    return () => onDocApi(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, path, enterEdit, exitEditRequest])

  if (error) return <div className="empty-state">Could not open {path}: {error}</div>
  if (!doc) return <div className="empty-state">Loading…</div>

  const jumpToCurrentStep = () => {
    const boxes = articleRef.current?.querySelectorAll('input[type="checkbox"]')
    const next = boxes && Array.from(boxes).find((b) => !(b as HTMLInputElement).checked)
    const li = next?.closest('li')
    if (!li) return
    li.scrollIntoView({ behavior: 'smooth', block: 'center' })
    li.classList.add('step-flash')
    setTimeout(() => li.classList.remove('step-flash'), 1600)
  }
  const showJumpButton = !editing && doc.meta.type === 'plan' && countUnchecked(doc.body) > 0

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
            <ProvenanceLabel meta={doc.meta} />
            <span className="type-label" title={new Date(doc.mtime).toLocaleString()}>
              edited {ago(new Date(doc.mtime).toISOString())}
            </span>
            {doc.claudeActivity && <ClaudeActivityBadge activity={doc.claudeActivity} />}
            {doc.parent && (
              <span className="derived-from-label">
                ↳ derived from{' '}
                <button className="link-btn" onClick={() => openDoc(doc.parent!.path)}>
                  {doc.parent.title}
                </button>
              </span>
            )}
          </div>
          {doc.meta.agentNote && (
            <div className={`agent-note${doc.meta.status === 'waiting' ? ' waiting' : ''}`}>⏸ {doc.meta.agentNote}</div>
          )}
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
          <div className="prop-row">
            <label>Derived from</label>
            <button ref={parentBtnRef} className="prop-value-btn title-value" title={doc.parent?.path} onClick={openParentPicker}>
              {doc.parent?.title ?? '—'}
            </button>
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
        {pickerOpen === 'parent' && (
          <PickerMenu
            anchorRef={parentBtnRef}
            searchable
            searchPlaceholder="Filter documents…"
            options={[
              { value: '', label: '— Clear' },
              ...allDocs
                .filter((d) => d.path !== path)
                .sort((a, b) => a.title.localeCompare(b.title))
                .map((d) => ({ value: d.meta.id, label: d.title })),
            ]}
            current={doc.meta.derivedFrom ?? ''}
            onSelect={chooseParent}
            onClose={() => setPickerOpen(null)}
          />
        )}

        {doc.derived.length > 0 && (
          <PanelGroup title="Derived documents">
            {doc.derived.map((d) => (
              <button key={d.path} className="panel-btn" title={d.path} onClick={() => openDoc(d.path)}>
                {d.title}
              </button>
            ))}
          </PanelGroup>
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
          {doc.meta.status !== 'archived' && (
            <Tooltip label="Hide from the vault tree — find it later in Archived">
              <button className="panel-btn" onClick={archive}>Archive</button>
            </Tooltip>
          )}
          <button className="panel-btn" onClick={rename}>Move / rename…</button>
          <button className="panel-btn" onClick={() => api.reveal({ path })}>Reveal in Finder</button>
          <Tooltip label="Print-styled PDF of this document">
            <button className="panel-btn" disabled={exporting} onClick={exportPdf}>
              {exporting ? 'Exporting…' : 'Export as PDF'}
            </button>
          </Tooltip>
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

      {showJumpButton && (
        <Tooltip label="Jump to the first unchecked step">
          <button className="jump-step-btn" onClick={jumpToCurrentStep}>
            <JumpIcon />
          </button>
        </Tooltip>
      )}
    </div>
  )
}

function JumpIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="var(--brand)" strokeWidth="1.5">
      <circle cx="8" cy="8" r="5.5" />
      <circle cx="8" cy="8" r="1.4" fill="var(--brand)" stroke="none" />
      <path d="M8 1v2.2M8 12.8V15M1 8h2.2M12.8 8H15" strokeLinecap="round" />
    </svg>
  )
}

function ProvenanceLabel({ meta }: { meta: DocMeta }) {
  const { source, imported } = meta
  let text: string
  if (source?.mode && source.project) {
    text = `${source.mode === 'move' ? 'moved' : 'copied'} from ${source.project}${imported ? ` · ${ago(imported)}` : ''}`
  } else if (source?.project) {
    text = `from ${source.project}${imported ? ` · ${ago(imported)}` : ''}`
  } else if (imported) {
    text = `created ${ago(imported)}`
  } else {
    return null
  }

  const tooltip = source?.path
    ? `${source.path}${imported ? ` — ${new Date(imported).toLocaleString()}` : ''}`
    : imported
      ? new Date(imported).toLocaleString()
      : undefined

  const label = (
    <span className="type-label provenance-label">{text}</span>
  )
  return tooltip ? <Tooltip label={tooltip}>{label}</Tooltip> : label
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
