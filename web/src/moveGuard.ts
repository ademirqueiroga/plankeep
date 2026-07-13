import { api } from './api'
import { ago } from './components/ActivityView'

const RECENT_MS = 60 * 60 * 1000

/** Warns when a Claude session wrote to this doc/folder within the last hour; undefined when stale or none. */
export async function activityWarning(q: { path?: string; folder?: string; abs?: string }): Promise<string | undefined> {
  const res = await api.activity(q)
  if (!res.lastClaudeWrite) return undefined
  const age = Date.now() - new Date(res.lastClaudeWrite).getTime()
  if (age > RECENT_MS) return undefined
  if (q.folder !== undefined && res.path) {
    return `A Claude session wrote to ${res.path} under this folder ${ago(res.lastClaudeWrite)} — moving it will break that session's path references.`
  }
  return `A Claude session wrote to this document ${ago(res.lastClaudeWrite)} — moving it will break that session's path references.`
}
