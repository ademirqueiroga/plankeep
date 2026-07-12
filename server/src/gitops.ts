import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { simpleGit, type SimpleGit } from 'simple-git'
import { loadConfig, saveConfig } from './config.js'
import { vaultRoot } from './vault.js'

const execFileP = promisify(execFile)

function git(): SimpleGit {
  return simpleGit({ baseDir: vaultRoot() })
}

export async function ensureVaultRepo(): Promise<void> {
  const root = vaultRoot()
  fs.mkdirSync(root, { recursive: true })
  if (!fs.existsSync(path.join(root, '.git'))) {
    await git().init(['-b', 'main'])
  }
  const pk = path.join(root, '.plankeep')
  fs.mkdirSync(pk, { recursive: true })
  if (!fs.existsSync(path.join(pk, 'queue.yaml'))) {
    fs.writeFileSync(path.join(pk, 'queue.yaml'), 'queue: []\n')
  }
  if (!fs.existsSync(path.join(root, 'README.md'))) {
    fs.writeFileSync(
      path.join(root, 'README.md'),
      '# Plans Vault\n\nManaged by [PlanKeep](https://github.com/ademirqueiroga). Plain markdown files organized in folders; metadata lives in each file\'s front-matter under the `plankeep:` key. The "up next" queue is `.plankeep/queue.yaml`.\n',
    )
    await commitAll('vault: initial structure')
  }
}

/** Commit everything in the vault. No-op when the tree is clean or autoCommit is off. */
export async function commitAll(message: string): Promise<boolean> {
  const config = loadConfig()
  if (!config.git.autoCommit) return false
  const g = git()
  const status = await g.status()
  if (status.files.length === 0) return false
  await g.add(['-A'])
  await g.commit(message)
  if (config.git.autoPush && config.git.remote) {
    pushSilently()
  }
  return true
}

let pushTimer: ReturnType<typeof setTimeout> | null = null
function pushSilently(): void {
  // debounce so bursts of edits produce one push
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    git()
      .push(['-u', 'origin', 'HEAD'])
      .catch(() => {
        /* surfaced via status endpoint on next check */
      })
  }, 3000)
}

export interface GitState {
  initialized: boolean
  branch: string
  dirty: number
  remote: string
  ahead: number
  behind: number
  conflicted: boolean
  lastError?: string
}

let lastSyncError: string | undefined

export async function gitState(): Promise<GitState> {
  const g = git()
  const initialized = fs.existsSync(path.join(vaultRoot(), '.git'))
  if (!initialized) {
    return { initialized, branch: '', dirty: 0, remote: '', ahead: 0, behind: 0, conflicted: false }
  }
  const status = await g.status()
  const remotes = await g.getRemotes(true)
  const origin = remotes.find((r) => r.name === 'origin')
  return {
    initialized,
    branch: status.current ?? '',
    dirty: status.files.length,
    remote: origin?.refs.push ?? '',
    ahead: status.ahead,
    behind: status.behind,
    conflicted: status.conflicted.length > 0,
    lastError: lastSyncError,
  }
}

export async function setRemote(url: string): Promise<void> {
  const g = git()
  const remotes = await g.getRemotes()
  if (remotes.some((r) => r.name === 'origin')) {
    await g.remote(['set-url', 'origin', url])
  } else {
    await g.addRemote('origin', url)
  }
  const config = loadConfig()
  config.git.remote = url
  saveConfig(config)
}

/**
 * Sync = commit local changes, pull --rebase, push. Conflict resolution is
 * intentionally out of scope: on conflict we abort nothing and report state so
 * the user resolves in a real git tool, then hits re-sync.
 */
export async function sync(): Promise<GitState> {
  const g = git()
  lastSyncError = undefined
  try {
    await commitAll('vault: sync checkpoint')
    const remotes = await g.getRemotes()
    if (remotes.some((r) => r.name === 'origin')) {
      const status = await g.status()
      if (status.conflicted.length === 0) {
        try {
          await g.pull(['--rebase', 'origin', 'HEAD'])
        } catch (e) {
          lastSyncError = `pull: ${(e as Error).message.split('\n')[0]}`
        }
        if (!lastSyncError) {
          await g.push(['-u', 'origin', 'HEAD'])
        }
      }
    }
  } catch (e) {
    lastSyncError = (e as Error).message.split('\n')[0]
  }
  return gitState()
}

/** Create a private GitHub repo for the vault via the gh CLI and wire it as origin. */
export async function createGithubRepo(name: string): Promise<{ url: string }> {
  const { stdout } = await execFileP('gh', ['repo', 'create', name, '--private'], { cwd: vaultRoot() })
  const httpsUrl = stdout.trim().split('\n').pop() ?? ''
  const repoPath = httpsUrl.replace(/^https:\/\/github.com\//, '').replace(/\.git$/, '')
  const sshUrl = `git@github.com:${repoPath}.git`
  await setRemote(sshUrl)
  await git().push(['-u', 'origin', 'HEAD'])
  return { url: httpsUrl }
}

export async function log(limit = 30): Promise<Array<{ hash: string; date: string; message: string }>> {
  const initialized = fs.existsSync(path.join(vaultRoot(), '.git'))
  if (!initialized) return []
  try {
    const res = await git().log({ maxCount: limit })
    return res.all.map((l) => ({ hash: l.hash.slice(0, 10), date: l.date, message: l.message }))
  } catch {
    return []
  }
}
