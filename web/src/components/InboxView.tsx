import { useEffect, useMemo, useState } from 'react'
import { api, type Config, type InboxItem } from '../api'
import { CopyBtn } from './CopyBtn'
import { dialog } from './Dialog'

type SortMode = 'mtime' | 'added' | 'path'
const SORT_KEY = 'pk-inbox-sort'
const SORT_LABELS: Record<SortMode, string> = { mtime: 'Last modified', added: 'Date added', path: 'Path' }

function loadSort(): SortMode {
  const v = localStorage.getItem(SORT_KEY)
  return v === 'added' || v === 'path' ? v : 'mtime'
}

function sortItems(items: InboxItem[], sort: SortMode): InboxItem[] {
  const arr = [...items]
  if (sort === 'mtime') arr.sort((a, b) => b.mtime - a.mtime)
  else if (sort === 'added') arr.sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime())
  else arr.sort((a, b) => a.path.localeCompare(b.path))
  return arr
}

function freshness(mtime: number): { label: string; cls: string } {
  const sec = (Date.now() - mtime) / 1000
  if (sec < 90) return { label: 'now', cls: 'fresh-now' }
  if (sec < 3600) return { label: `${Math.max(1, Math.round(sec / 60))}m`, cls: 'fresh-now' }
  if (sec < 86400) return { label: `${Math.round(sec / 3600)}h`, cls: 'fresh-recent' }
  if (sec < 30 * 86400) return { label: `${Math.round(sec / 86400)}d`, cls: 'fresh-recent' }
  return { label: `${Math.round(sec / (30 * 86400))}mo`, cls: 'fresh-stale' }
}

interface InboxViewProps {
  config: Config | null
  openDoc: (p: string) => void
  refresh: () => Promise<void>
}

export function InboxView({ config, openDoc, refresh }: InboxViewProps) {
  const [items, setItems] = useState<InboxItem[]>([])
  const [sort, setSort] = useState<SortMode>(loadSort)
  const [scanMsg, setScanMsg] = useState<string | null>(null)

  const load = () => api.inbox().then(setItems)
  useEffect(() => {
    load()
  }, [])
  useEffect(() => {
    localStorage.setItem(SORT_KEY, sort)
  }, [sort])

  const sorted = useMemo(() => sortItems(items, sort), [items, sort])

  const runScan = async () => {
    setScanMsg('Scanning…')
    const r = await api.scan()
    setScanMsg(`Scan done: ${r.added} new candidate(s) (${r.examined} files examined).`)
    await load()
    await refresh()
  }

  const excludeFolder = async (item: InboxItem) => {
    const dir = item.path.slice(0, item.path.lastIndexOf('/')) || item.path
    const entry = await dialog.prompt({
      title: 'Exclude folder',
      body: 'Files under this path will no longer appear in the inbox. Edit to widen (use * / **).',
      label: 'Path or glob',
      initial: dir,
    })
    if (!entry?.trim()) return
    await api.saveSettings({ excludePaths: [...(config?.excludePaths ?? []), entry.trim()] })
    await load()
    await refresh()
  }

  return (
    <div className="view">
      <div className="view-header">
        <h1>Inbox</h1>
        <div className="inbox-header-actions">
          <div className="segmented">
            {(Object.keys(SORT_LABELS) as SortMode[]).map((m) => (
              <button key={m} className={`segment${sort === m ? ' active' : ''}`} onClick={() => setSort(m)}>
                {SORT_LABELS[m]}
              </button>
            ))}
          </div>
          <button onClick={runScan}>Scan for plans</button>
        </div>
      </div>
      <p className="hint">
        Markdown files detected by the Claude Code hook or the scanner, waiting to be imported. Importing copies (or moves, per your choice) the file into the vault under a folder named after its source project.
      </p>
      {scanMsg && <div className="banner">{scanMsg}</div>}
      {sorted.length === 0 && <div className="empty-state">Nothing pending. New plan files written by Claude will show up here automatically.</div>}
      {sorted.map((item) => (
        <InboxRow
          key={item.path}
          item={item}
          defaultMode={config?.importMode ?? 'copy'}
          onExclude={() => excludeFolder(item)}
          onDone={async (imported) => {
            await load()
            await refresh()
            if (imported) openDoc(imported)
          }}
        />
      ))}
    </div>
  )
}

function InboxRow({
  item,
  defaultMode,
  onExclude,
  onDone,
}: {
  item: InboxItem
  defaultMode: string
  onExclude: () => void
  onDone: (imported?: string) => Promise<void>
}) {
  const [folder, setFolder] = useState(item.project)
  const [mode, setMode] = useState(defaultMode)
  const [busy, setBusy] = useState(false)

  const doImport = async () => {
    setBusy(true)
    try {
      const r = await api.importFile(item.path, folder, mode, item.project)
      await onDone(r.path)
    } finally {
      setBusy(false)
    }
  }

  const fresh = freshness(item.mtime)
  const added = new Date(item.detectedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <div className="inbox-row">
      <div className="inbox-info">
        <div className="inbox-title-line">
          <span className="inbox-title">{item.title}</span>
          <span className={`fresh-badge ${fresh.cls}`} title={new Date(item.mtime).toLocaleString()}>{fresh.label}</span>
          <span className="tag">{item.origin}</span>
        </div>
        {item.preview.length > 0 && <div className="inbox-preview">{item.preview.join(' ')}</div>}
        <div className="inbox-path">{item.path} <CopyBtn value={item.path} /></div>
        <div className="inbox-sub">Added {added} · project {item.project}</div>
      </div>
      <div className="inbox-actions">
        <input value={folder} onChange={(e) => setFolder(e.target.value)} title="Destination vault folder" />
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="copy">copy</option>
          <option value="move">move</option>
        </select>
        <button className="primary" disabled={busy} onClick={doImport}>Import</button>
        <button disabled={busy} onClick={() => api.dismiss(item.path).then(() => onDone())}>Dismiss</button>
        <button disabled={busy} onClick={onExclude}>Exclude folder…</button>
      </div>
    </div>
  )
}
