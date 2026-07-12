import { useEffect, useRef, useState } from 'react'
import { Tooltip } from './Tooltip'

export interface OutlineItem {
  id: string
  depth: number
  text: string
}

const MAX_DASHES = 30
const DASH_WIDTH: Record<number, number> = { 1: 18, 2: 13, 3: 9, 4: 6 }

interface OutlineNavProps {
  items: OutlineItem[]
  activeId: string | null
  onNavigate: (id: string) => void
  pinned: boolean
  onPinnedChange: (pinned: boolean) => void
}

export function OutlineNav({ items, activeId, onNavigate, pinned, onPinnedChange }: OutlineNavProps) {
  const [hovering, setHovering] = useState(false)
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeItemRef = useRef<HTMLButtonElement>(null)
  const expanded = pinned || hovering

  const cancelCollapse = () => {
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current)
      collapseTimer.current = null
    }
  }

  const scheduleCollapse = () => {
    cancelCollapse()
    collapseTimer.current = setTimeout(() => setHovering(false), 300)
  }

  useEffect(() => () => cancelCollapse(), [])

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeId, expanded])

  return (
    <div className="outline-nav" onMouseEnter={() => { cancelCollapse(); setHovering(true) }} onMouseLeave={scheduleCollapse}>
      {!expanded && (
        <Tooltip label="Outline">
          <div className="outline-collapsed">
            {items.slice(0, MAX_DASHES).map((item) => (
              <div
                key={item.id}
                className={`outline-dash${item.id === activeId ? ' active' : ''}`}
                style={{ width: DASH_WIDTH[item.depth] ?? 6 }}
              />
            ))}
          </div>
        </Tooltip>
      )}
      {expanded && (
        <div className="outline-panel">
          <div className="outline-panel-header">
            <span className="panel-group-title">Outline</span>
            <button
              className={`outline-pin${pinned ? ' active' : ''}`}
              onClick={() => onPinnedChange(!pinned)}
              title={pinned ? 'Unpin outline' : 'Pin outline open'}
            >
              <PinIcon />
            </button>
          </div>
          <div className="outline-items">
            {items.map((item) => (
              <button
                key={item.id}
                ref={item.id === activeId ? activeItemRef : undefined}
                className={`outline-item${item.id === activeId ? ' active' : ''}`}
                style={{ paddingLeft: 10 + (item.depth - 1) * 12 }}
                onClick={() => onNavigate(item.id)}
                title={item.text}
              >
                {item.text}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function PinIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 2.5v4.5l2.5 2.5h-6L7 7V2.5z" strokeLinejoin="round" />
      <path d="M8 9.5V13" strokeLinecap="round" />
    </svg>
  )
}
