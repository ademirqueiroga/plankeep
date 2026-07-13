import fs from 'node:fs'
import path from 'node:path'
import { configDir } from './config.js'

const MAX_ENTRIES = 500

export interface ActivityRecord {
  at: string // ISO timestamp of the Claude write
  sessionId?: string // hook event session_id
  cwd?: string // hook event cwd (the session's working directory)
  tool?: string // 'Write' | 'Edit'
}

function activityFile(): string {
  return path.join(configDir(), 'activity.json')
}

/** Legacy entries were a bare ISO string; normalize to the record shape so old files keep working. */
function readActivity(): Record<string, ActivityRecord> {
  try {
    const raw = JSON.parse(fs.readFileSync(activityFile(), 'utf8')) as Record<string, string | ActivityRecord>
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === 'string' ? { at: v } : v]))
  } catch {
    return {}
  }
}

function writeActivity(entries: Record<string, ActivityRecord>): void {
  fs.writeFileSync(activityFile(), JSON.stringify(entries, null, 2) + '\n')
}

/** Upsert the last-write record for an absolute path; prune to the most-recent MAX_ENTRIES. */
export function recordClaudeWrite(abs: string, info?: Omit<ActivityRecord, 'at'>): void {
  const entries = readActivity()
  entries[abs] = { ...info, at: new Date().toISOString() }
  const pruned = Object.entries(entries)
    .sort((a, b) => b[1].at.localeCompare(a[1].at))
    .slice(0, MAX_ENTRIES)
  writeActivity(Object.fromEntries(pruned))
}

export function lastClaudeWrite(abs: string): ActivityRecord | null {
  return readActivity()[abs] ?? null
}

/** Most recent entry whose path sits under absDir — used for folder-level activity checks. */
export function lastClaudeWriteUnder(absDir: string): { path: string; record: ActivityRecord } | null {
  const prefix = absDir.endsWith(path.sep) ? absDir : absDir + path.sep
  let best: { path: string; record: ActivityRecord } | null = null
  for (const [p, record] of Object.entries(readActivity())) {
    if (p !== absDir && !p.startsWith(prefix)) continue
    if (!best || record.at > best.record.at) best = { path: p, record }
  }
  return best
}

/** All activity entries keyed by absolute path — load once per listing rather than per doc. */
export function getActivityMap(): Record<string, ActivityRecord> {
  return readActivity()
}
