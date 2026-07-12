import fs from 'node:fs'
import path from 'node:path'
import { configDir } from './config.js'

export interface InboxItem {
  path: string
  project: string
  detectedAt: string
  origin: 'hook' | 'scan'
  status: 'pending' | 'dismissed' | 'imported'
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
