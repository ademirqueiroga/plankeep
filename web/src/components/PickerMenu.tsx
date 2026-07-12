import { useEffect, useRef, useState } from 'react'

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
}

export function PickerMenu({ anchorRef, options, current, onSelect, onClose }: PickerMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [highlight, setHighlight] = useState(() => Math.max(0, options.findIndex((o) => o.value === current)))

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
        setHighlight((h) => (h + 1) % options.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlight((h) => (h - 1 + options.length) % options.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onSelect(options[highlight].value)
        onClose()
      } else if (e.key.length === 1) {
        const idx = options.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()))
        if (idx !== -1) setHighlight(idx)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [highlight, options, onSelect, onClose])

  const rect = anchorRef.current?.getBoundingClientRect()
  const style = rect ? { left: rect.left, top: rect.bottom + 4 } : undefined

  return (
    <div ref={ref} className="picker-menu" style={style}>
      {options.map((opt, i) => (
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
  )
}
