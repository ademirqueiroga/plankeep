import type { DocSummary, TreeNode } from './api'

export type TreeSort = 'name' | 'added' | 'updated'

export interface OrganizedDoc {
  node: TreeNode
  children: OrganizedDoc[]
}

export const TREE_SORT_KEY = 'pk-tree-sort'
export const TREE_SORTS: TreeSort[] = ['name', 'added', 'updated']
export const TREE_SORT_LABELS: Record<TreeSort, string> = {
  name: 'Name',
  added: 'Date added',
  updated: 'Last updated',
}

export function loadTreeSort(): TreeSort {
  const v = localStorage.getItem(TREE_SORT_KEY)
  return v === 'added' || v === 'updated' ? v : 'name'
}

/** Creation time for sorting: docs predating the provenance work have no `imported` — fall back to mtime. */
function addedAt(node: TreeNode): number {
  const imported = node.doc?.meta.imported
  const t = imported ? Date.parse(imported) : NaN
  return Number.isNaN(t) ? (node.doc?.mtime ?? 0) : t
}

function comparator(sort: TreeSort): (a: TreeNode, b: TreeNode) => number {
  if (sort === 'added') return (a, b) => addedAt(b) - addedAt(a) || a.name.localeCompare(b.name)
  if (sort === 'updated') return (a, b) => (b.doc?.mtime ?? 0) - (a.doc?.mtime ?? 0) || a.name.localeCompare(b.name)
  return (a, b) => (a.doc?.title ?? a.name).localeCompare(b.doc?.title ?? b.name)
}

/**
 * Order and nest the doc children of one folder node.
 * - archived docs are filtered out (their non-archived children float back to top level rather than vanishing)
 * - docs whose `meta.derivedFrom` resolves to a sibling in the SAME folder nest under it, recursively
 * - siblings at every level are sorted by the active mode
 * - a derivedFrom chain that loops leaves the docs involved flat
 */
export function organizeDocs(docs: TreeNode[], sort: TreeSort): OrganizedDoc[] {
  const visible = docs.filter((d) => d.kind === 'doc' && d.doc && d.doc.meta.status !== 'archived')
  const byId = new Map<string, TreeNode>()
  for (const d of visible) byId.set(d.doc!.meta.id, d)

  const childrenOf = new Map<TreeNode, TreeNode[]>()
  const roots: TreeNode[] = []
  for (const d of visible) {
    const parent = resolveParent(d, byId)
    if (parent) {
      const list = childrenOf.get(parent)
      if (list) list.push(d)
      else childrenOf.set(parent, [d])
    } else {
      roots.push(d)
    }
  }

  const cmp = comparator(sort)
  const build = (node: TreeNode): OrganizedDoc => ({
    node,
    children: (childrenOf.get(node) ?? []).sort(cmp).map(build),
  })
  return roots.sort(cmp).map(build)
}

/** The sibling this doc nests under, or null when it has no parent here / the link would loop. */
function resolveParent(doc: TreeNode, byId: Map<string, TreeNode>): TreeNode | null {
  const parentId = doc.doc?.meta.derivedFrom
  if (!parentId) return null
  const parent = byId.get(parentId)
  // parent outside this folder, deleted, archived, or the doc itself → stay top-level
  if (!parent || parent === doc) return null
  const seen = new Set<TreeNode>()
  let cur: TreeNode | undefined = parent
  while (cur) {
    if (cur === doc || seen.has(cur)) return null
    seen.add(cur)
    const nextId: string | undefined = cur.doc?.meta.derivedFrom
    cur = nextId ? byId.get(nextId) : undefined
  }
  return parent
}

/** Depth-first flatten of organizeDocs output — keyboard nav and range-select walk this. */
export function flattenOrganized(items: OrganizedDoc[], level = 0): Array<{ node: TreeNode; level: number }> {
  const out: Array<{ node: TreeNode; level: number }> = []
  for (const item of items) {
    out.push({ node: item.node, level })
    out.push(...flattenOrganized(item.children, level + 1))
  }
  return out
}

/** Archived docs anywhere under a tree node — drives the sidebar's "Archived (N)" entry point. */
export function countArchived(node: TreeNode | null): number {
  if (!node) return 0
  let n = 0
  for (const child of node.children ?? []) {
    if (child.kind === 'folder') n += countArchived(child)
    else if (child.doc?.meta.status === 'archived') n++
  }
  return n
}

/** True when pointing `childId` at `parentId` would create a derivedFrom loop (self-reference included). */
export function createsCycle(childId: string, parentId: string, docs: DocSummary[]): boolean {
  if (childId === parentId) return true
  const byId = new Map(docs.map((d) => [d.meta.id, d]))
  const seen = new Set<string>()
  let cur = byId.get(parentId)
  while (cur) {
    if (cur.meta.id === childId) return true
    if (seen.has(cur.meta.id)) return false
    seen.add(cur.meta.id)
    cur = cur.meta.derivedFrom ? byId.get(cur.meta.derivedFrom) : undefined
  }
  return false
}
