import fs from 'node:fs'
import path from 'node:path'
import { configDir } from './config.js'

const MAX_ENTRIES = 500

function activityFile(): string {
  return path.join(configDir(), 'activity.json')
}

function readActivity(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(activityFile(), 'utf8'))
  } catch {
    return {}
  }
}

function writeActivity(entries: Record<string, string>): void {
  fs.writeFileSync(activityFile(), JSON.stringify(entries, null, 2) + '\n')
}

/** Upsert the last-write timestamp for an absolute path; prune to the most-recent MAX_ENTRIES. */
export function recordClaudeWrite(abs: string): void {
  const entries = readActivity()
  entries[abs] = new Date().toISOString()
  const pruned = Object.entries(entries)
    .sort((a, b) => b[1].localeCompare(a[1]))
    .slice(0, MAX_ENTRIES)
  writeActivity(Object.fromEntries(pruned))
}

export function lastClaudeWrite(abs: string): string | null {
  return readActivity()[abs] ?? null
}

/** Most recent entry whose path sits under absDir — used for folder-level activity checks. */
export function lastClaudeWriteUnder(absDir: string): { path: string; at: string } | null {
  const prefix = absDir.endsWith(path.sep) ? absDir : absDir + path.sep
  let best: { path: string; at: string } | null = null
  for (const [p, at] of Object.entries(readActivity())) {
    if (p !== absDir && !p.startsWith(prefix)) continue
    if (!best || at > best.at) best = { path: p, at }
  }
  return best
}
