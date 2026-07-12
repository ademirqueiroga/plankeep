import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface PlanKeepConfig {
  vaultPath: string
  importMode: 'copy' | 'move'
  git: {
    remote: string
    autoCommit: boolean
    autoPush: boolean
  }
  scanRoots: string[]
  port: number
}

const CONFIG_DIR = path.join(os.homedir(), '.plankeep')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

const DEFAULTS: PlanKeepConfig = {
  vaultPath: path.join(os.homedir(), 'plans-vault'),
  importMode: 'copy',
  git: { remote: '', autoCommit: true, autoPush: false },
  scanRoots: [path.join(os.homedir(), '.claude', 'plans'), path.join(os.homedir(), 'workspace')],
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

export function loadConfig(): PlanKeepConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
    return {
      ...DEFAULTS,
      ...raw,
      git: { ...DEFAULTS.git, ...(raw.git ?? {}) },
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveConfig(config: PlanKeepConfig): void {
  configDir()
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n')
}

export function vaultPath(): string {
  return expandTilde(loadConfig().vaultPath)
}
