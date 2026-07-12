import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { vaultRoot, summarize, type DocSummary } from './vault.js'

function queueFile(): string {
  return path.join(vaultRoot(), '.plankeep', 'queue.yaml')
}

/** Queue as stored, including entries whose file is momentarily absent (mid-rename). */
function rawQueue(): string[] {
  try {
    const data = YAML.parse(fs.readFileSync(queueFile(), 'utf8'))
    return Array.isArray(data?.queue) ? data.queue : []
  } catch {
    return []
  }
}

export function getQueue(): string[] {
  // hide entries whose file no longer exists, but never persist that filtering
  return rawQueue().filter((rel) => fs.existsSync(path.join(vaultRoot(), rel)))
}

export function setQueue(paths: string[]): void {
  fs.mkdirSync(path.dirname(queueFile()), { recursive: true })
  fs.writeFileSync(queueFile(), YAML.stringify({ queue: paths }))
}

export function queueDocs(): DocSummary[] {
  const out: DocSummary[] = []
  for (const rel of getQueue()) {
    try {
      out.push(summarize(rel))
    } catch {
      // skip
    }
  }
  return out
}

/** Rename a queue entry when a doc moves so queue order survives reorganization.
    Must operate on rawQueue: the file was already moved, so the existence
    filter would silently drop the entry before it could be rewritten. */
export function renameInQueue(from: string, to: string): void {
  setQueue(rawQueue().map((p) => (p === from ? to : p)))
}

/** Rewrite queue entries under a renamed folder prefix (raw for the same reason). */
export function renamePrefixInQueue(fromPrefix: string, toPrefix: string): void {
  setQueue(rawQueue().map((p) => (p === fromPrefix || p.startsWith(fromPrefix + '/') ? toPrefix + p.slice(fromPrefix.length) : p)))
}

export function removeFromQueue(rel: string): void {
  setQueue(rawQueue().filter((p) => p !== rel))
}

export function addToQueue(rel: string, position?: number): void {
  const queue = rawQueue().filter((p) => p !== rel)
  if (position === undefined || position >= queue.length) queue.push(rel)
  else queue.splice(Math.max(0, position), 0, rel)
  setQueue(queue)
}
