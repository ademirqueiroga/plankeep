import type { View } from './App'
import { api } from './api'
import { dialog } from './components/Dialog'

const AI_ACTIONS = [
  { id: 'improve', label: 'AI: Improve readability' },
  { id: 'checkboxify', label: 'AI: Add checkboxes' },
  { id: 'refresh', label: 'AI: Refresh vs repo' },
] as const

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
  const docPath = ctx.view.kind === 'doc' ? ctx.view.path : null

  const navigate: Command[] = [
    { id: 'go-queue', title: 'Go to Up Next', group: 'Navigate', run: (c) => c.setView({ kind: 'queue' }) },
    { id: 'go-inbox', title: 'Go to Inbox', group: 'Navigate', run: (c) => c.setView({ kind: 'inbox' }) },
    { id: 'go-search', title: 'Go to Search view', group: 'Navigate', run: (c) => c.setView({ kind: 'search' }) },
    { id: 'go-settings', title: 'Go to Settings', group: 'Navigate', run: (c) => c.setView({ kind: 'settings' }) },
  ]

  const document: Command[] = [
    { id: 'doc-edit', title: 'Edit markdown', keys: 'E', group: 'Document', when: () => inDoc, run: (c) => c.docApi?.enterEdit() },
    { id: 'doc-status', title: 'Set status…', keys: 'S', group: 'Document', when: () => inDoc, run: (c) => c.docApi?.openStatusPicker() },
    { id: 'doc-type', title: 'Set type…', keys: 'T', group: 'Document', when: () => inDoc, run: (c) => c.docApi?.openTypePicker() },
    { id: 'doc-labels', title: 'Edit labels…', keys: 'L', group: 'Document', when: () => inDoc, run: (c) => c.docApi?.focusLabels() },
    { id: 'doc-copy-path', title: 'Copy vault path', group: 'Document', when: () => inDoc, run: (c) => c.docApi?.copyVaultPath() },
    { id: 'doc-copy-abs', title: 'Copy absolute path', group: 'Document', when: () => inDoc, run: (c) => c.docApi?.copyAbsPath() },
    { id: 'doc-copy-mention', title: 'Copy @mention', group: 'Document', when: () => inDoc, run: (c) => c.docApi?.copyMention() },
    { id: 'doc-add-queue', title: 'Add to Up Next', group: 'Document', when: () => inDoc, run: (c) => c.docApi?.addToQueue() },
    { id: 'doc-rename', title: 'Move / rename…', group: 'Document', when: () => inDoc, run: (c) => c.docApi?.rename() },
    { id: 'doc-reveal', title: 'Reveal in Finder', group: 'Document', when: () => !!docPath, run: () => docPath && api.reveal({ path: docPath }) },
    ...AI_ACTIONS.map((a): Command => ({
      id: `doc-ai-${a.id}`,
      title: a.label,
      group: 'Document',
      when: () => inDoc,
      run: (c) => c.docApi?.runAi(a.id),
    })),
    { id: 'doc-delete', title: 'Delete document…', group: 'Document', when: () => inDoc, run: (c) => c.docApi?.del() },
  ]

  const vault: Command[] = [
    {
      id: 'vault-new-folder',
      title: 'New folder…',
      group: 'Vault',
      run: async (c) => {
        const name = await dialog.prompt({ title: 'New folder', label: 'Folder name (use / for nesting)' })
        if (name?.trim()) {
          await api.createFolder(name.trim())
          await c.refresh()
        }
      },
    },
    { id: 'vault-scan', title: 'Scan for plans', group: 'Vault', run: async (c) => { await api.scan(); await c.refresh() } },
    { id: 'vault-sync', title: 'Sync now', group: 'Vault', run: async (c) => { await api.gitSync(); await c.refresh() } },
  ]

  return [...navigate, ...document, ...vault]
}
