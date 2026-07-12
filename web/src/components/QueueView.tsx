import { useEffect, useState } from 'react'
import { api, type DocSummary } from '../api'
import { CopyBtn } from './CopyBtn'

export function QueueView({ openDoc, refresh }: { openDoc: (p: string) => void; refresh: () => Promise<void> }) {
  const [docs, setDocs] = useState<DocSummary[]>([])
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const load = () => api.queue().then(setDocs)
  useEffect(() => {
    load()
  }, [])

  const persist = async (next: DocSummary[]) => {
    setDocs(next)
    setDocs(await api.setQueue(next.map((d) => d.path)))
  }

  const moveTo = (from: number, to: number) => {
    if (to < 0 || to >= docs.length || from === to) return
    const next = [...docs]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    persist(next)
  }

  return (
    <div className="view">
      <h1>Up Next</h1>
      <p className="hint">Ordered queue of what you want to tackle next. Drag to reorder — the order is stored in the vault (<code>.plankeep/queue.yaml</code>) and visible to LLMs via MCP.</p>
      {docs.length === 0 && <div className="empty-state">Queue is empty. Open a document and use “Add to Up Next”.</div>}
      <ol className="queue">
        {docs.map((d, i) => (
          <li
            key={d.path}
            className={`queue-item status-${d.meta.status}`}
            draggable
            onDragStart={() => setDragIndex(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragIndex !== null) moveTo(dragIndex, i)
              setDragIndex(null)
            }}
          >
            <span className="queue-pos">{i + 1}</span>
            <div className="queue-body" onClick={() => openDoc(d.path)}>
              <div className="queue-title">{d.title}</div>
              <div className="queue-path">{d.path} <CopyBtn value={d.path} /></div>
              {d.progress.total > 0 && (
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${(d.progress.done / d.progress.total) * 100}%` }} />
                  <span className="progress-label">{d.progress.done}/{d.progress.total}</span>
                </div>
              )}
            </div>
            <div className="queue-actions">
              <button className="icon-btn" onClick={() => moveTo(i, i - 1)} title="Move up">↑</button>
              <button className="icon-btn" onClick={() => moveTo(i, i + 1)} title="Move down">↓</button>
              <button className="icon-btn danger" onClick={() => api.queueRemove(d.path).then(setDocs).then(refresh)} title="Remove from queue">✕</button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
