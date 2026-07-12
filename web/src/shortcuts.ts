import type { View } from './App'

export interface DocApi {
  enterEdit: () => void
  exitEditRequest: () => void
  openStatusPicker: () => void
  openTypePicker: () => void
  focusLabels: () => void
  copyVaultPath: () => void
  copyAbsPath: () => void
  copyMention: () => void
  runAi: (action: string) => void
  del: () => void
  rename: () => void
  addToQueue: () => void
}

export interface Ctx {
  view: View
  setView: (v: View) => void
  openDoc: (path: string) => void
  refresh: () => Promise<void>
  docApi?: DocApi
}

export interface Command {
  id: string
  title: string
  keys?: string
  group: 'Navigate' | 'Document' | 'Vault' | 'AI'
  when?: (ctx: Ctx) => boolean
  run: (ctx: Ctx) => void | Promise<void>
}

/** Matches a Command's display `keys` string against a live keydown event. */
export function matchesShortcut(keys: string, e: KeyboardEvent): boolean {
  if (keys === '⌘K') return (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k'
  if (keys.length === 1) return !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === keys.toLowerCase()
  return false
}

export function buildCommands(ctx: Ctx): Command[] {
  const inDoc = ctx.view.kind === 'doc' && !!ctx.docApi

  return [
    { id: 'doc-edit', title: 'Edit markdown', keys: 'E', group: 'Document', when: () => inDoc, run: (c) => c.docApi?.enterEdit() },
    { id: 'doc-status', title: 'Set status…', keys: 'S', group: 'Document', when: () => inDoc, run: (c) => c.docApi?.openStatusPicker() },
    { id: 'doc-type', title: 'Set type…', keys: 'T', group: 'Document', when: () => inDoc, run: (c) => c.docApi?.openTypePicker() },
    { id: 'doc-labels', title: 'Edit labels…', keys: 'L', group: 'Document', when: () => inDoc, run: (c) => c.docApi?.focusLabels() },
  ]
}
