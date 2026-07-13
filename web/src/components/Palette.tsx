import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type SearchHit } from '../api'
import type { View } from '../App'
import { buildCommands, type DocApi } from '../shortcuts'

function fuzzyMatch(query: string, text: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
}

interface PaletteProps {
  open: boolean
  onClose: () => void
  view: View
  setView: (v: View) => void
  openDoc: (path: string) => void
  refresh: () => Promise<void>
  docApi: DocApi | null
  toggleSidebar: () => void
}

export function Palette({ open, onClose, view, setView, openDoc, refresh, docApi, toggleSidebar }: PaletteProps) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setHits([])
      setHighlight(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  const ctx = useMemo(
    () => ({ view, setView, openDoc, refresh, docApi: docApi ?? undefined, toggleSidebar }),
    [view, setView, openDoc, refresh, docApi, toggleSidebar],
  )

  const commands = useMemo(
    () => buildCommands(ctx).filter((c) => (!c.when || c.when(ctx)) && fuzzyMatch(query, c.title)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx, query],
  )

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.trim().length < 2) {
      setHits([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      const res = await api.search(query.trim())
      setHits(res.slice(0, 8))
    }, 150)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  useEffect(() => setHighlight(0), [query, commands.length, hits.length])

  if (!open) return null

  const total = commands.length + hits.length

  const runAt = (i: number) => {
    if (i < commands.length) {
      commands[i].run(ctx)
    } else {
      const hit = hits[i - commands.length]
      if (hit) openDoc(hit.path)
    }
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (total > 0) setHighlight((h) => (h + 1) % total)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (total > 0) setHighlight((h) => (h - 1 + total) % total)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (total > 0) runAt(highlight)
    }
  }

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <div className="palette-panel" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a command or search documents…"
        />
        <div className="palette-results">
          {commands.length > 0 && (
            <div className="palette-group">
              <div className="palette-group-title">Commands</div>
              {commands.map((cmd, i) => (
                <PaletteRow key={cmd.id} highlighted={i === highlight} danger={cmd.danger} onMouseEnter={() => setHighlight(i)} onClick={() => runAt(i)}>
                  <span>{cmd.title}</span>
                  {cmd.keys && <kbd>{cmd.keys}</kbd>}
                </PaletteRow>
              ))}
            </div>
          )}
          {hits.length > 0 && (
            <div className="palette-group">
              <div className="palette-group-title">Documents</div>
              {hits.map((hit, i) => {
                const idx = commands.length + i
                return (
                  <PaletteRow key={hit.path} highlighted={idx === highlight} onMouseEnter={() => setHighlight(idx)} onClick={() => runAt(idx)}>
                    <span>{hit.title}</span>
                    <span className="palette-doc-path">{hit.path}</span>
                  </PaletteRow>
                )
              })}
            </div>
          )}
          {total === 0 && <div className="palette-empty">No matches</div>}
        </div>
      </div>
    </div>
  )
}

function PaletteRow({
  highlighted,
  danger,
  onMouseEnter,
  onClick,
  children,
}: {
  highlighted: boolean
  danger?: boolean
  onMouseEnter: () => void
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      className={`palette-row${highlighted ? ' highlighted' : ''}${danger ? ' danger' : ''}`}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
