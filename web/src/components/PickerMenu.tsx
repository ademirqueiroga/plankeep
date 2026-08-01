import { useEffect, useMemo, useRef, useState } from 'react'

export interface PickerOption {
  value: string
  label: string
  render?: React.ReactNode
}

interface PickerMenuProps {
  anchorRef: React.RefObject<HTMLElement | null>
  options: PickerOption[]
  current: string
  onSelect: (value: string) => void
  onClose: () => void
  /** Adds a type-to-filter input at the top — for long lists like "pick a document". */
  searchable?: boolean
  searchPlaceholder?: string
}

export function PickerMenu({ anchorRef, options, current, onSelect, onClose, searchable, searchPlaceholder }: PickerMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const shown = useMemo(() => {
    if (!searchable || !query.trim()) return options
    const q = query.trim().toLowerCase()
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, query, searchable])
  const [highlight, setHighlight] = useState(() => Math.max(0, options.findIndex((o) => o.value === current)))

  useEffect(() => {
    if (searchable) inputRef.current?.focus()
  }, [searchable])

  useEffect(() => {
    setHighlight(0)
  }, [query])

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchorRef.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', away)
    return () => window.removeEventListener('mousedown', away)
  }, [onClose, anchorRef])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (shown.length) setHighlight((h) => (h + 1) % shown.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (shown.length) setHighlight((h) => (h - 1 + shown.length) % shown.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (!shown[highlight]) return
        onSelect(shown[highlight].value)
        onClose()
      } else if (!searchable && e.key.length === 1) {
        // type-ahead jump — only when there's no filter input to receive the keystroke
        const idx = shown.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()))
        if (idx !== -1) setHighlight(idx)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [highlight, shown, onSelect, onClose, searchable])

  const rect = anchorRef.current?.getBoundingClientRect()
  const style = rect ? { left: rect.left, top: rect.bottom + 4 } : undefined

  return (
    <div ref={ref} className={`picker-menu${searchable ? ' picker-searchable' : ''}`} style={style}>
      {searchable && (
        <input
          ref={inputRef}
          className="picker-search"
          value={query}
          placeholder={searchPlaceholder ?? 'Filter…'}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <div className="picker-options">
        {shown.length === 0 && <div className="picker-empty">No matches</div>}
        {shown.map((opt, i) => (
          <button
            key={opt.value}
            className={`menu-item${i === highlight ? ' picker-highlight' : ''}`}
            onMouseEnter={() => setHighlight(i)}
            onClick={() => {
              onSelect(opt.value)
              onClose()
            }}
          >
            <span>{opt.render ?? opt.label}</span>
            {opt.value === current && <span className="picker-check">✓</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
