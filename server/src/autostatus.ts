import path from 'node:path'
import * as activity from './activity.js'
import * as vault from './vault.js'
import * as gitops from './gitops.js'

/**
 * Flip vault docs draft→active when Claude wrote to them after their last app-side update.
 * Never touches active/done/archived docs — those are handled elsewhere (auto-done) or are
 * deliberately at rest. Returns the flipped vault-relative paths.
 */
export async function sweepAutoActive(): Promise<string[]> {
  const root = vault.vaultRoot()
  const prefix = root.endsWith(path.sep) ? root : root + path.sep
  const flipped: string[] = []

  for (const [abs, record] of Object.entries(activity.getActivityMap())) {
    if (abs !== root && !abs.startsWith(prefix)) continue
    const rel = path.relative(root, abs)
    try {
      const { meta } = vault.readDoc(rel)
      if (meta.status !== 'draft') continue
      if (!(record.at > (meta.updated ?? ''))) continue
      vault.updateMeta(rel, { status: 'active' })
      await gitops.commitAll(`auto-status: active — Claude session activity: ${rel}`)
      flipped.push(rel)
    } catch {
      // doc moved/deleted since the activity was recorded — skip
    }
  }

  return flipped
}
