import type { View } from './App'
import { api, type VaultEntry } from './api'
import { dialog } from './components/Dialog'
import { TREE_SORT_LABELS, TREE_SORTS, type TreeSort } from './treeOrder'

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
  archive: () => void
  toggleOutline: () => void
  togglePanel: () => void
}

export interface Ctx {
  view: View
  setView: (v: View) => void
  openDoc: (path: string) => void
  refresh: () => Promise<void>
  docApi?: DocApi
  toggleSidebar: () => void
  vaults?: VaultEntry[]
  activeVault?: string
  switchVault?: (name: string) => Promise<void>
  treeSort?: TreeSort
  setTreeSort?: (s: TreeSort) => void
}

export interface Command {
  id: string
  title: string
  keys?: string
  group: 'Navigate' | 'Document' | 'Vault' | 'AI' | 'View'
  danger?: boolean
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
    { id: 'go-activity', title: 'Go to Activity', group: 'Navigate', run: (c) => c.setView({ kind: 'activity' }) },
    { id: 'go-memories', title: 'Go to Memories', group: 'Navigate', run: (c) => c.setView({ kind: 'memories' }) },
    { id: 'go-search', title: 'Go to Search view', group: 'Navigate', run: (c) => c.setView({ kind: 'search' }) },
    { id: 'go-archived', title: 'Go to Archived', group: 'Navigate', run: (c) => c.setView({ kind: 'archived' }) },
    { id: 'go-settings', title: 'Go to Settings', group: 'Navigate', run: (c) => c.setView({ kind: 'settings' }) },
    ...(ctx.vaults ?? [])
      .filter((v) => v.name !== ctx.activeVault)
      .map((v): Command => ({
        id: `switch-vault-${v.name}`,
        title: `Switch vault: ${v.name}`,
        group: 'Navigate',
        run: (c) => c.switchVault?.(v.name),
      })),
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
    { id: 'doc-archive', title: 'Archive document', group: 'Document', when: () => inDoc, run: (c) => c.docApi?.archive() },
    { id: 'doc-toggle-outline', title: 'Toggle outline', group: 'Document', when: () => inDoc, run: (c) => c.docApi?.toggleOutline() },
    { id: 'doc-rename', title: 'Move / rename…', group: 'Document', when: () => inDoc, run: (c) => c.docApi?.rename() },
    { id: 'doc-reveal', title: 'Reveal in Finder', group: 'Document', when: () => !!docPath, run: () => docPath && api.reveal({ path: docPath }) },
    ...AI_ACTIONS.map((a): Command => ({
      id: `doc-ai-${a.id}`,
      title: a.label,
      group: 'Document',
      when: () => inDoc,
      run: (c) => c.docApi?.runAi(a.id),
    })),
    { id: 'doc-delete', title: 'Delete document…', group: 'Document', danger: true, when: () => inDoc, run: (c) => c.docApi?.del() },
  ]

  const view: Command[] = [
    { id: 'view-toggle-sidebar', title: 'Toggle sidebar', keys: '[', group: 'View', run: (c) => c.toggleSidebar() },
    { id: 'view-toggle-panel', title: 'Toggle right panel', keys: ']', group: 'View', when: () => inDoc, run: (c) => c.docApi?.togglePanel() },
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
    ...TREE_SORTS.filter((s) => s !== ctx.treeSort).map((s): Command => ({
      id: `tree-sort-${s}`,
      title: `Sort tree: ${TREE_SORT_LABELS[s].toLowerCase()}`,
      group: 'Vault',
      when: (c) => !!c.setTreeSort,
      run: (c) => c.setTreeSort?.(s),
    })),
  ]

  return [...navigate, ...document, ...view, ...vault]
}
