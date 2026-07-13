import { useEffect } from 'react'
import { buildCommands, type Ctx } from '../shortcuts'

const STUB_CTX: Ctx = {
  view: { kind: 'queue' },
  setView: () => {},
  openDoc: () => {},
  refresh: async () => {},
  toggleSidebar: () => {},
}

const GLOBAL_SHORTCUTS: Array<{ title: string; keys: string }> = [
  { title: 'Open command palette', keys: '⌘K' },
  { title: 'Open command palette (alt)', keys: '⌥Space' },
  { title: 'Close dialog / cancel edit', keys: 'Esc' },
]

const GROUPS = ['Navigate', 'Document', 'View', 'Vault', 'AI'] as const

export function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const commands = buildCommands(STUB_CTX).filter((c) => c.keys)

  return (
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div className="dialog-panel shortcuts-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-title">Keyboard shortcuts</div>

        <div className="shortcuts-group">
          <div className="palette-group-title">Global</div>
          {GLOBAL_SHORTCUTS.map((s) => (
            <div className="shortcut-row" key={s.title}>
              <span>{s.title}</span>
              <kbd>{s.keys}</kbd>
            </div>
          ))}
        </div>

        {GROUPS.map((group) => {
          const items = commands.filter((c) => c.group === group)
          if (items.length === 0) return null
          return (
            <div className="shortcuts-group" key={group}>
              <div className="palette-group-title">{group}</div>
              {items.map((c) => (
                <div className="shortcut-row" key={c.id}>
                  <span>{c.title}</span>
                  <kbd>{c.keys}</kbd>
                </div>
              ))}
            </div>
          )
        })}

        <div className="dialog-actions">
          <button autoFocus className="primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
