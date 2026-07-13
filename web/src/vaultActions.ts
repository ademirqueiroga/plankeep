import { api } from './api'
import { dialog } from './components/Dialog'

/** Three sequential prompts: name → local path → optional clone URL. Returns true if a vault was added. */
export async function addVaultFlow(): Promise<boolean> {
  const name = await dialog.prompt({ title: 'Add vault', label: 'Vault name', placeholder: 'team' })
  if (!name?.trim()) return false
  const path = await dialog.prompt({
    title: 'Add vault',
    label: 'Local path',
    initial: `~/plans-vault-${name.trim()}`,
  })
  if (path === null || !path.trim()) return false
  const cloneUrl = await dialog.prompt({
    title: 'Add vault',
    label: 'Clone from remote URL (leave empty to create/init locally)',
    placeholder: 'git@github.com:you/team-vault.git',
  })
  try {
    await api.addVault(name.trim(), path.trim(), cloneUrl?.trim() || undefined)
    return true
  } catch (e) {
    window.alert((e as Error).message)
    return false
  }
}
