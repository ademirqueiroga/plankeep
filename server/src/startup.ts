import { ensureVaultRepo, commitAll } from './gitops.js'
import { cleanStaleLinks } from './vault.js'
import { sweepAutoActive } from './autostatus.js'

/** Run whenever a vault becomes the active one — at server boot and after switching. */
export async function onVaultActivated(): Promise<void> {
  await ensureVaultRepo()
  const removed = cleanStaleLinks()
  if (removed > 0) await commitAll(`cleanup: ${removed} stale link(s)`)
  await sweepAutoActive()
}
