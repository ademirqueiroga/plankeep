import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { configDir } from './config.js'
import { titleOf } from './vault.js'

export interface InboxItem {
  path: string
  project: string
  detectedAt: string
  origin: 'hook' | 'scan'
  status: 'pending' | 'dismissed' | 'imported'
}

export interface EnrichedInboxItem extends InboxItem {
  mtime: number
  title: string
  preview: string[]
}

const PREVIEW_BYTES = 4096
const CHECKBOX_LINE_RE = /^\s*[-*+]\s+\[( |x|X)\]/

function stripFrontMatter(raw: string): string {
  try {
    return matter(raw).content
  } catch {
    // front-matter may be truncated by the byte cap — fall back to a manual strip
    return raw.replace(/^---\n[\s\S]*?\n---\n?/, '')
  }
}

function computePreview(content: string): string[] {
  const preview: string[] = []
  for (const line of content.split('\n')) {
    const t = line.trim()
    if (!t || t === '---' || t.startsWith('#') || CHECKBOX_LINE_RE.test(t)) continue
    preview.push(t.slice(0, 160))
    if (preview.length === 2) break
  }
  return preview
}

/** Read the first bytes of a file — enough for title/preview extraction without loading huge files. */
function readHead(p: string, bytes: number): string {
  const fd = fs.openSync(p, 'r')
  try {
    const buf = Buffer.alloc(bytes)
    const bytesRead = fs.readSync(fd, buf, 0, bytes, 0)
    return buf.toString('utf8', 0, bytesRead)
  } finally {
    fs.closeSync(fd)
  }
}

/** Compute display fields for an inbox item. Returns null if the source file vanished mid-read. */
export function enrich(item: InboxItem): EnrichedInboxItem | null {
  try {
    const mtime = fs.statSync(item.path).mtimeMs
    const content = stripFrontMatter(readHead(item.path, PREVIEW_BYTES))
    const fallback = path.basename(item.path, '.md')
    return { ...item, mtime, title: titleOf(content, fallback), preview: computePreview(content) }
  } catch {
    return null
  }
}

function inboxFile(): string {
  return path.join(configDir(), 'inbox.json')
}

export function readInbox(): InboxItem[] {
  try {
    return JSON.parse(fs.readFileSync(inboxFile(), 'utf8'))
  } catch {
    return []
  }
}

export function writeInbox(items: InboxItem[]): void {
  fs.writeFileSync(inboxFile(), JSON.stringify(items, null, 2) + '\n')
}

/** Add a candidate unless it was already seen (any status). Returns true when added. */
export function addCandidate(item: Omit<InboxItem, 'status' | 'detectedAt'>): boolean {
  const items = readInbox()
  if (items.some((i) => i.path === item.path)) return false
  items.push({ ...item, detectedAt: new Date().toISOString(), status: 'pending' })
  writeInbox(items)
  return true
}

export function setStatus(p: string, status: InboxItem['status']): void {
  const items = readInbox()
  const item = items.find((i) => i.path === p)
  if (item) {
    item.status = status
    writeInbox(items)
  }
}

export function pending(): InboxItem[] {
  // hide entries whose source file disappeared
  return readInbox().filter((i) => i.status === 'pending' && fs.existsSync(i.path))
}

export function pendingEnriched(): EnrichedInboxItem[] {
  return pending()
    .map(enrich)
    .filter((i): i is EnrichedInboxItem => i !== null)
}
