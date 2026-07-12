import { useRef, useState } from 'react'

export function Tooltip({ label, keys, children }: { label: string; keys?: string; children: React.ReactElement }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const anchorRef = useRef<HTMLSpanElement>(null)

  const show = () => {
    timer.current = setTimeout(() => {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = Math.min(Math.max(rect.left + rect.width / 2, 60), window.innerWidth - 60)
      setPos({ x, y: rect.bottom + 6 })
    }, 300)
  }

  const hide = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setPos(null)
  }

  return (
    <span ref={anchorRef} className="tooltip-anchor" onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {pos && (
        <span className="tooltip-tip" style={{ left: pos.x, top: pos.y }}>
          {label}
          {keys && <kbd>{keys}</kbd>}
        </span>
      )}
    </span>
  )
}
