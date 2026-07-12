import { useEffect, useState } from 'react'
import { api, type SearchHit } from '../api'
import { CopyBtn } from './CopyBtn'

export function SearchView({ openDoc }: { openDoc: (p: string) => void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([])
      return
    }
    const t = setTimeout(() => api.search(q.trim()).then(setHits), 250)
    return () => clearTimeout(t)
  }, [q])

  return (
    <div className="view">
      <h1>🔎 Search</h1>
      <input className="search-input" autoFocus placeholder="Search titles, paths, tags and content…" value={q} onChange={(e) => setQ(e.target.value)} />
      {q.trim().length >= 2 && <p className="hint">{hits.length} result(s)</p>}
      {hits.map((h) => (
        <div key={h.path} className="search-hit" onClick={() => openDoc(h.path)}>
          <div className="search-title">
            {h.title} <span className="tag">{h.meta.type}</span> <span className="tag">{h.meta.status}</span>
          </div>
          <div className="search-path">{h.path} <CopyBtn value={h.path} /></div>
          {h.snippets.map((s, i) => (
            <div key={i} className="snippet">{s}</div>
          ))}
        </div>
      ))}
    </div>
  )
}
