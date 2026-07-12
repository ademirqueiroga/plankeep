import { useEffect, useRef, useState } from 'react'

type ConfirmOpts = { title: string; body?: string; confirmLabel?: string; danger?: boolean }
type PromptOpts = { title: string; body?: string; label?: string; initial?: string; placeholder?: string; confirmLabel?: string }
type ConfirmTypedOpts = { title: string; body?: string; mustType: string; danger?: boolean }
type SaveDiscardOpts = { title: string; body?: string }

type Request =
  | { kind: 'confirm'; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOpts; resolve: (v: string | null) => void }
  | { kind: 'confirmTyped'; opts: ConfirmTypedOpts; resolve: (v: boolean) => void }
  | { kind: 'saveDiscard'; opts: SaveDiscardOpts; resolve: (v: 'save' | 'discard' | 'cancel') => void }

let listener: ((req: Request | null) => void) | null = null

function push(req: Request) {
  listener?.(req)
}

export const dialog = {
  confirm(opts: ConfirmOpts): Promise<boolean> {
    return new Promise((resolve) => push({ kind: 'confirm', opts, resolve }))
  },
  prompt(opts: PromptOpts): Promise<string | null> {
    return new Promise((resolve) => push({ kind: 'prompt', opts, resolve }))
  },
  confirmTyped(opts: ConfirmTypedOpts): Promise<boolean> {
    return new Promise((resolve) => push({ kind: 'confirmTyped', opts, resolve }))
  },
  saveDiscard(opts: SaveDiscardOpts): Promise<'save' | 'discard' | 'cancel'> {
    return new Promise((resolve) => push({ kind: 'saveDiscard', opts, resolve }))
  },
  isOpen(): boolean {
    return currentOpenCount > 0
  },
}

let currentOpenCount = 0

export function DialogHost() {
  const [req, setReq] = useState<Request | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [typedValue, setTypedValue] = useState('')
  const [promptValue, setPromptValue] = useState('')

  useEffect(() => {
    listener = (r) => setReq(r)
    return () => {
      listener = null
    }
  }, [])

  useEffect(() => {
    currentOpenCount = req ? currentOpenCount + 1 : Math.max(0, currentOpenCount - 1)
    if (req?.kind === 'confirmTyped') setTypedValue('')
    if (req?.kind === 'prompt') setPromptValue(req.opts.initial ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req])

  const close = () => setReq(null)

  const finish = <T,>(resolve: (v: T) => void, value: T) => {
    resolve(value)
    close()
  }

  useEffect(() => {
    if (!req) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (req.kind === 'saveDiscard') finish(req.resolve, 'cancel')
        else if (req.kind === 'prompt') finish(req.resolve, null)
        else finish(req.resolve, false)
      } else if (e.key === 'Enter' && req.kind !== 'prompt') {
        // prompt's own input handles Enter (needs its live value)
        if (req.kind === 'confirmTyped') {
          if (typedValue === req.opts.mustType) finish(req.resolve, true)
        } else if (req.kind === 'saveDiscard') {
          finish(req.resolve, 'save')
        } else {
          finish(req.resolve, true)
        }
      } else if (e.key === 'Tab') {
        const focusables = panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')
        if (!focusables || focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [req, typedValue])

  if (!req) return null

  const onOverlayClick = () => {
    if (req.kind === 'saveDiscard') finish(req.resolve, 'cancel')
    else if (req.kind === 'prompt') finish(req.resolve, null)
    else finish(req.resolve, false)
  }

  return (
    <div className="dialog-overlay" onMouseDown={onOverlayClick}>
      <div className="dialog-panel" ref={panelRef} onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-title">{req.opts.title}</div>
        {req.opts.body && <div className="dialog-body">{req.opts.body}</div>}

        {req.kind === 'prompt' && (
          <div className="dialog-field">
            {req.opts.label && <label>{req.opts.label}</label>}
            <input
              autoFocus
              value={promptValue}
              placeholder={req.opts.placeholder}
              onChange={(e) => setPromptValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  finish(req.resolve, promptValue)
                }
              }}
            />
          </div>
        )}

        {req.kind === 'confirmTyped' && (
          <div className="dialog-field">
            <label>Type <strong>{req.opts.mustType}</strong> to confirm</label>
            <input
              autoFocus
              value={typedValue}
              onChange={(e) => setTypedValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && typedValue === req.opts.mustType) {
                  e.preventDefault()
                  finish(req.resolve, true)
                }
              }}
            />
          </div>
        )}

        <div className="dialog-actions">
          {req.kind === 'confirm' && (
            <>
              <button onClick={() => finish(req.resolve, false)}>Cancel</button>
              <button
                autoFocus
                className={req.opts.danger ? 'danger' : 'primary'}
                onClick={() => finish(req.resolve, true)}
              >
                {req.opts.confirmLabel ?? 'Confirm'}
              </button>
            </>
          )}
          {req.kind === 'prompt' && (
            <>
              <button onClick={() => finish(req.resolve, null)}>Cancel</button>
              <button className="primary" onClick={() => finish(req.resolve, promptValue)}>
                {req.opts.confirmLabel ?? 'Confirm'}
              </button>
            </>
          )}
          {req.kind === 'confirmTyped' && (
            <>
              <button onClick={() => finish(req.resolve, false)}>Cancel</button>
              <button
                className={req.opts.danger ? 'danger' : 'primary'}
                disabled={typedValue !== req.opts.mustType}
                onClick={() => finish(req.resolve, true)}
              >
                Delete
              </button>
            </>
          )}
          {req.kind === 'saveDiscard' && (
            <>
              <button onClick={() => finish(req.resolve, 'cancel')}>Cancel</button>
              <button className="danger" onClick={() => finish(req.resolve, 'discard')}>Discard</button>
              <button autoFocus className="primary" onClick={() => finish(req.resolve, 'save')}>Save</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
