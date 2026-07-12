import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { vaultRoot, summarize, type DocSummary } from './vault.js'

function queueFile(): string {
  return path.join(vaultRoot(), '.plankeep', 'queue.yaml')
}

export function getQueue(): string[] {
  try {
    const data = YAML.parse(fs.readFileSync(queueFile(), 'utf8'))
    const queue: string[] = Array.isArray(data?.queue) ? data.queue : []
    // drop entries whose file no longer exists
    return queue.filter((rel) => fs.existsSync(path.join(vaultRoot(), rel)))
  } catch {
    return []
  }
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

/** Rename a queue entry when a doc moves so queue order survives reorganization. */
export function renameInQueue(from: string, to: string): void {
  setQueue(getQueue().map((p) => (p === from ? to : p)))
}

export function removeFromQueue(rel: string): void {
  setQueue(getQueue().filter((p) => p !== rel))
}

export function addToQueue(rel: string, position?: number): void {
  const queue = getQueue().filter((p) => p !== rel)
  if (position === undefined || position >= queue.length) queue.push(rel)
  else queue.splice(Math.max(0, position), 0, rel)
  setQueue(queue)
}
