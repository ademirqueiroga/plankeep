import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import matter from 'gray-matter'
import { expandTilde, loadConfig, vaultPath } from './config.js'
import { getActivityMap, type ActivityRecord } from './activity.js'

export type DocType = 'plan' | 'findings' | 'exploration' | 'research' | 'note'
export type DocStatus = 'draft' | 'active' | 'done' | 'archived'

export interface DocMeta {
  id: string
  type: DocType
  status: DocStatus
  tags: string[]
  source?: { project?: string; path?: string }
  imported?: string
  updated?: string
}

export interface DocSummary {
  path: string
  title: string
  meta: DocMeta
  progress: { done: number; total: number }
  mtime: number
  claudeActivity?: { at: string; sessionId?: string; cwd?: string }
}

export interface TreeNode {
  name: string
  path: string
  kind: 'folder' | 'doc'
  children?: TreeNode[]
  doc?: DocSummary
}

const EXCLUDED_DIRS = new Set(['.git', '.plankeep', 'node_modules'])
const CHECKBOX_RE = /^\s*[-*+]\s+\[( |x|X)\]/gm
// Kept in sync with scanner.ts's CLAUDE_MEMORY_RE — duplicated to avoid a circular import (scanner.ts imports from vault.ts).
const CLAUDE_MEMORY_RE = /\/\.claude\/projects\/[^/]+\/memory\//

export function vaultRoot(): string {
  return vaultPath()
}

/** Resolve a vault-relative path, refusing traversal outside the vault. */
export function safePath(rel: string): string {
  const root = vaultRoot()
  const abs = path.resolve(root, rel)
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(`Path escapes vault: ${rel}`)
  }
  return abs
}

export function checkboxProgress(content: string): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const m of content.matchAll(CHECKBOX_RE)) {
    total++
    if (m[1].toLowerCase() === 'x') done++
  }
  return { done, total }
}

function normalizeMeta(raw: unknown): DocMeta {
  const m = (raw ?? {}) as Partial<DocMeta>
  return {
    id: m.id ?? crypto.randomUUID(),
    type: m.type ?? 'note',
    status: m.status ?? 'draft',
    tags: Array.isArray(m.tags) ? m.tags : [],
    source: m.source,
    imported: m.imported,
    updated: m.updated,
  }
}

export function titleOf(content: string, fallback: string): string {
  const h1 = content.match(/^#\s+(.+)$/m)
  return h1 ? h1[1].trim() : fallback
}

export function readDoc(rel: string): { content: string; body: string; meta: DocMeta; title: string } {
  const raw = fs.readFileSync(safePath(rel), 'utf8')
  const parsed = matter(raw)
  const meta = normalizeMeta(parsed.data?.plankeep)
  return {
    content: raw,
    body: parsed.content,
    meta,
    title: titleOf(parsed.content, path.basename(rel, '.md')),
  }
}

/** Write a doc, merging the plankeep metadata block into existing front-matter. */
export function writeDoc(rel: string, body: string, meta: DocMeta, extraFrontmatter?: Record<string, unknown>): void {
  const abs = safePath(rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  meta.updated = new Date().toISOString()
  const data = { ...(extraFrontmatter ?? {}), plankeep: JSON.parse(JSON.stringify(meta)) }
  fs.writeFileSync(abs, matter.stringify(body.replace(/^\n+/, ''), data))
}

/**
 * Save raw content (front-matter included) as sent by an editor or MCP, keeping meta consistent.
 * When overwriting an existing doc, incoming `plankeep` front-matter fields win field-by-field but
 * anything the incoming content doesn't specify (e.g. no front-matter at all) keeps the doc's
 * existing id/type/status/tags/source/imported rather than resetting to defaults.
 */
export function saveRawDoc(rel: string, content: string): void {
  const parsed = matter(content)
  const extra = { ...parsed.data }
  delete extra.plankeep

  const abs = safePath(rel)
  const meta = fs.existsSync(abs)
    ? { ...readDoc(rel).meta, ...(parsed.data?.plankeep ?? {}) }
    : normalizeMeta(parsed.data?.plankeep)

  writeDoc(rel, parsed.content, meta, extra)
}

/** Replace only the markdown body, keeping front-matter/metadata intact. */
export function updateBody(rel: string, body: string): void {
  const doc = readDoc(rel)
  const parsed = matter(doc.content)
  const extra = { ...parsed.data }
  delete extra.plankeep
  writeDoc(rel, body, doc.meta, extra)
}

/** Returns the new status if checkbox completion implies a change, else null. */
export function autoStatusFor(rel: string): DocStatus | null {
  const { body, meta } = readDoc(rel)
  const { done, total } = checkboxProgress(body)
  if (total > 0 && done === total && meta.status !== 'done' && meta.status !== 'archived') return 'done'
  if (meta.status === 'done' && total > 0 && done < total) return 'active'
  return null
}

export function updateMeta(rel: string, patch: Partial<Pick<DocMeta, 'type' | 'status' | 'tags'>>): DocMeta {
  const doc = readDoc(rel)
  const parsed = matter(doc.content)
  const extra = { ...parsed.data }
  delete extra.plankeep
  const meta = { ...doc.meta, ...patch }
  writeDoc(rel, parsed.content, meta, extra)
  return meta
}

export function summarize(rel: string, activityMap?: Record<string, ActivityRecord>): DocSummary {
  const doc = readDoc(rel)
  const abs = safePath(rel)
  const record = (activityMap ?? getActivityMap())[abs]
  return {
    path: rel,
    title: doc.title,
    meta: doc.meta,
    progress: checkboxProgress(doc.body),
    mtime: fs.statSync(abs).mtimeMs,
    claudeActivity: record ? { at: record.at, sessionId: record.sessionId, cwd: record.cwd } : undefined,
  }
}

export function listDocs(): DocSummary[] {
  const activityMap = getActivityMap()
  const out: DocSummary[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) walk(path.join(dir, entry.name))
      } else if (entry.name.endsWith('.md')) {
        const rel = path.relative(vaultRoot(), path.join(dir, entry.name))
        try {
          out.push(summarize(rel, activityMap))
        } catch {
          // unreadable file — skip
        }
      }
    }
  }
  if (fs.existsSync(vaultRoot())) walk(vaultRoot())
  return out
}

export function tree(): TreeNode {
  const activityMap = getActivityMap()
  const build = (dir: string, rel: string): TreeNode => {
    const node: TreeNode = { name: rel === '' ? '/' : path.basename(dir), path: rel, kind: 'folder', children: [] }
    if (!fs.existsSync(dir)) return node
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    const folders = entries
      .filter((e) => e.isDirectory() && !EXCLUDED_DIRS.has(e.name))
      .sort((a, b) => a.name.localeCompare(b.name))
    const docs = entries.filter((e) => e.isFile() && e.name.endsWith('.md')).sort((a, b) => a.name.localeCompare(b.name))
    for (const f of folders) node.children!.push(build(path.join(dir, f.name), rel ? `${rel}/${f.name}` : f.name))
    for (const d of docs) {
      const drel = rel ? `${rel}/${d.name}` : d.name
      try {
        node.children!.push({ name: d.name, path: drel, kind: 'doc', doc: summarize(drel, activityMap) })
      } catch {
        // skip unreadable
      }
    }
    return node
  }
  return build(vaultRoot(), '')
}

export function createFolder(rel: string): void {
  fs.mkdirSync(safePath(rel), { recursive: true })
  // git does not track empty dirs; drop a .gitkeep so folders survive sync
  fs.writeFileSync(path.join(safePath(rel), '.gitkeep'), '')
}

export function moveDoc(from: string, to: string): void {
  const dest = safePath(to)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.renameSync(safePath(from), dest)
}

export function deleteDoc(rel: string): void {
  fs.rmSync(safePath(rel))
}

export function deleteFolder(rel: string): void {
  if (!rel) throw new Error('Refusing to delete vault root')
  fs.rmSync(safePath(rel), { recursive: true })
}

export function renameFolder(from: string, to: string): void {
  if (!from || !to) throw new Error('Refusing to rename vault root')
  const dest = safePath(to)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.renameSync(safePath(from), dest)
}

/** Count docs under a folder — used by the UI for safe-delete confirmation. */
export function folderStats(rel: string): { docs: number } {
  let docs = 0
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !EXCLUDED_DIRS.has(entry.name)) walk(path.join(dir, entry.name))
      else if (entry.name.endsWith('.md')) docs++
    }
  }
  walk(safePath(rel))
  return { docs }
}

/** Remove leftover move-safety symlinks: broken ones regardless of age, others once older than maxAgeDays. */
export function cleanStaleLinks(maxAgeDays = 7): number {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
  let removed = 0
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        const broken = !fs.existsSync(abs)
        if (broken || fs.lstatSync(abs).mtimeMs < cutoff) {
          fs.rmSync(abs)
          removed++
        }
        continue
      }
      if (entry.isDirectory() && !EXCLUDED_DIRS.has(entry.name)) walk(abs)
    }
  }
  walk(vaultRoot())
  return removed
}

export function guessType(filename: string): DocType {
  const n = filename.toLowerCase()
  if (n.includes('plan')) return 'plan'
  if (n.includes('finding') || n.includes('review')) return 'findings'
  if (n.includes('exploration') || n.includes('explore')) return 'exploration'
  if (n.includes('research') || n.includes('architecture') || n.includes('story')) return 'research'
  return 'note'
}

function uniqueDest(folder: string, filename: string): string {
  let rel = folder ? `${folder}/${filename}` : filename
  let i = 2
  while (fs.existsSync(safePath(rel))) {
    const base = filename.replace(/\.md$/, '')
    rel = folder ? `${folder}/${base}-${i}.md` : `${base}-${i}.md`
    i++
  }
  return rel
}

export interface ImportResult {
  path: string
  removedSource: boolean
}

/** Import an external markdown file into the vault (copy or move). */
export function importFile(
  sourceAbs: string,
  opts: { folder?: string; mode?: 'copy' | 'move'; project?: string; leaveLink?: boolean },
): ImportResult {
  const src = expandTilde(sourceAbs)
  if (CLAUDE_MEMORY_RE.test(src)) {
    throw new Error('Claude memory files cannot be imported — browse them in the Memories section')
  }
  const raw = fs.readFileSync(src, 'utf8')
  const mode = opts.mode ?? loadConfig().importMode
  const folder = (opts.folder ?? opts.project ?? '').replace(/^\/+|\/+$/g, '')
  const rel = uniqueDest(folder, path.basename(src))

  const parsed = matter(raw)
  const existing = normalizeMeta(parsed.data?.plankeep)
  const meta: DocMeta = {
    ...existing,
    type: parsed.data?.plankeep?.type ?? guessType(path.basename(src)),
    status: existing.status,
    source: { project: opts.project, path: src },
    imported: new Date().toISOString(),
  }
  const extra = { ...parsed.data }
  delete extra.plankeep
  writeDoc(rel, parsed.content, meta, extra)

  let removedSource = false
  if (mode === 'move') {
    fs.rmSync(src)
    removedSource = true
    if (opts.leaveLink && !fs.existsSync(src)) {
      const destAbs = safePath(rel)
      try {
        // realpath the containing dir first: on macOS /tmp is itself a symlink to /private/tmp,
        // and a relative target computed from the un-resolved dir would resolve to the wrong place.
        const realDir = fs.realpathSync(path.dirname(src))
        fs.symlinkSync(path.relative(realDir, destAbs), src)
      } catch {
        // best-effort — importing succeeded regardless
      }
    }
  }
  return { path: rel, removedSource }
}

/** Import in-memory content (e.g. browser drag-drop, MCP save). */
export function importContent(name: string, content: string, opts: { folder?: string; type?: DocType; project?: string }): string {
  const filename = name.endsWith('.md') ? name : `${name}.md`
  const folder = (opts.folder ?? '').replace(/^\/+|\/+$/g, '')
  const rel = uniqueDest(folder, path.basename(filename))
  const parsed = matter(content)
  const meta = normalizeMeta(parsed.data?.plankeep)
  meta.type = opts.type ?? guessType(filename)
  if (opts.project) meta.source = { ...(meta.source ?? {}), project: opts.project }
  meta.imported = new Date().toISOString()
  const extra = { ...parsed.data }
  delete extra.plankeep
  writeDoc(rel, parsed.content, meta, extra)
  return rel
}

export interface SearchHit {
  path: string
  title: string
  meta: DocMeta
  snippets: string[]
}

export function search(query: string): SearchHit[] {
  const q = query.toLowerCase()
  const hits: SearchHit[] = []
  for (const doc of listDocs()) {
    const { body, title, meta } = readDoc(doc.path)
    const snippets: string[] = []
    const lines = body.split('\n')
    for (let i = 0; i < lines.length && snippets.length < 4; i++) {
      if (lines[i].toLowerCase().includes(q)) snippets.push(lines[i].trim().slice(0, 200))
    }
    const inPath = doc.path.toLowerCase().includes(q)
    const inTitle = title.toLowerCase().includes(q)
    const inTags = meta.tags.some((t) => t.toLowerCase().includes(q))
    if (snippets.length > 0 || inPath || inTitle || inTags) {
      hits.push({ path: doc.path, title, meta, snippets })
    }
  }
  return hits
}

export interface LabelCount {
  label: string
  count: number
}

export function labelCounts(): LabelCount[] {
  const counts = new Map<string, number>()
  for (const doc of listDocs()) {
    for (const tag of doc.meta.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}
