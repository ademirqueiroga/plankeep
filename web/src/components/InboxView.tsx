import { useEffect, useState } from 'react'
import { api, type Config, type InboxItem } from '../api'
import { CopyBtn } from './CopyBtn'

interface InboxViewProps {
  config: Config | null
  openDoc: (p: string) => void
  refresh: () => Promise<void>
}

export function InboxView({ config, openDoc, refresh }: InboxViewProps) {
  const [items, setItems] = useState<InboxItem[]>([])
  const [scanMsg, setScanMsg] = useState<string | null>(null)

  const load = () => api.inbox().then(setItems)
  useEffect(() => {
    load()
  }, [])

  const runScan = async () => {
    setScanMsg('Scanning…')
    const r = await api.scan()
    setScanMsg(`Scan done: ${r.added} new candidate(s) (${r.examined} files examined).`)
    await load()
    await refresh()
  }

  return (
    <div className="view">
      <div className="view-header">
        <h1>Inbox</h1>
        <button onClick={runScan}>Scan for plans</button>
      </div>
      <p className="hint">
        Markdown files detected by the Claude Code hook or the scanner, waiting to be imported. Importing copies (or moves, per your choice) the file into the vault under a folder named after its source project.
      </p>
      {scanMsg && <div className="banner">{scanMsg}</div>}
      {items.length === 0 && <div className="empty-state">Nothing pending. New plan files written by Claude will show up here automatically.</div>}
      {items.map((item) => (
        <InboxRow key={item.path} item={item} defaultMode={config?.importMode ?? 'copy'} onDone={async (imported) => {
          await load()
          await refresh()
          if (imported) openDoc(imported)
        }} />
      ))}
    </div>
  )
}

function InboxRow({ item, defaultMode, onDone }: { item: InboxItem; defaultMode: string; onDone: (imported?: string) => Promise<void> }) {
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

  return (
    <div className="inbox-row">
      <div className="inbox-info">
        <div className="inbox-path">{item.path} <CopyBtn value={item.path} /></div>
        <div className="inbox-sub">
          project: <b>{item.project}</b> · via {item.origin} · {new Date(item.detectedAt).toLocaleString()}
        </div>
      </div>
      <div className="inbox-actions">
        <input value={folder} onChange={(e) => setFolder(e.target.value)} title="Destination vault folder" />
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="copy">copy</option>
          <option value="move">move</option>
        </select>
        <button className="primary" disabled={busy} onClick={doImport}>Import</button>
        <button disabled={busy} onClick={() => api.dismiss(item.path).then(() => onDone())}>Dismiss</button>
      </div>
    </div>
  )
}
