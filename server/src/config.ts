import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface VaultEntry {
  name: string // unique, shown in UI, e.g. "personal", "team"
  path: string // absolute or ~/ path
  remote?: string // per-vault git remote
  autoPush?: boolean // per-vault
}

export interface PlanKeepConfig {
  vaults: VaultEntry[]
  activeVault: string // name of the active entry
  importMode: 'copy' | 'move'
  git: { autoCommit: boolean } // remains global
  scanRoots: string[]
  excludePaths: string[]
  port: number
}

const CONFIG_DIR = path.join(os.homedir(), '.plankeep')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

const DEFAULTS: PlanKeepConfig = {
  vaults: [{ name: 'personal', path: path.join(os.homedir(), 'plans-vault') }],
  activeVault: 'personal',
  importMode: 'copy',
  git: { autoCommit: true },
  scanRoots: [path.join(os.homedir(), '.claude', 'plans'), path.join(os.homedir(), 'workspace')],
  excludePaths: [path.join(os.homedir(), '.claude', 'plans', '*', '*', 'progress')],
  port: 5175,
}

export function expandTilde(p: string): string {
  if (p === '~') return os.homedir()
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  return p
}

export function configDir(): string {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  return CONFIG_DIR
}

/** Legacy shape (pre-multi-vault) had a single `vaultPath` + `git.remote`/`git.autoPush`. */
interface LegacyConfigShape {
  vaultPath?: string
  git?: { remote?: string; autoCommit?: boolean; autoPush?: boolean }
}

export function loadConfig(): PlanKeepConfig {
  let raw: Record<string, unknown> & LegacyConfigShape
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
  } catch {
    return { ...DEFAULTS, vaults: DEFAULTS.vaults.map((v) => ({ ...v })) }
  }

  if (!Array.isArray(raw.vaults) && typeof raw.vaultPath === 'string') {
    const migrated: PlanKeepConfig = {
      ...DEFAULTS,
      ...raw,
      vaults: [
        {
          name: 'personal',
          path: raw.vaultPath,
          remote: raw.git?.remote || undefined,
          autoPush: raw.git?.autoPush,
        },
      ],
      activeVault: 'personal',
      git: { autoCommit: raw.git?.autoCommit ?? DEFAULTS.git.autoCommit },
    }
    delete (migrated as unknown as Record<string, unknown>).vaultPath
    saveConfig(migrated)
    return migrated
  }

  return {
    ...DEFAULTS,
    ...raw,
    vaults: Array.isArray(raw.vaults) ? (raw.vaults as VaultEntry[]) : DEFAULTS.vaults,
    git: { ...DEFAULTS.git, autoCommit: raw.git?.autoCommit ?? DEFAULTS.git.autoCommit },
  }
}

export function saveConfig(config: PlanKeepConfig): void {
  configDir()
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n')
}

/** The active vault entry — falls back to the first registered vault if activeVault names nothing. Never throws. */
export function activeVaultEntry(): VaultEntry {
  const config = loadConfig()
  return config.vaults.find((v) => v.name === config.activeVault) ?? config.vaults[0]
}

export function vaultPath(): string {
  return expandTilde(activeVaultEntry().path)
}

/** Expanded absolute paths of every registered vault. */
export function allVaultRoots(): string[] {
  return loadConfig().vaults.map((v) => expandTilde(v.path))
}

/** Resolve a registered vault's expanded root path by name. Throws if the name is unknown. */
export function vaultRootByName(name: string): string {
  const entry = loadConfig().vaults.find((v) => v.name === name)
  if (!entry) throw new Error(`No vault named "${name}"`)
  return expandTilde(entry.path)
}
