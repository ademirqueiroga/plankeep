import fs from 'node:fs'
import path from 'node:path'
import { expandTilde, loadConfig } from './config.js'
import { vaultRoot } from './vault.js'
import { addCandidate } from './inbox.js'

const EXCLUDED_NAMES = new Set([
  'readme.md',
  'claude.md',
  'agents.md',
  'changelog.md',
  'contributing.md',
  'license.md',
  'code_of_conduct.md',
  'security.md',
  'memory.md',
  'pull_request_template.md',
])

export function isCandidateFile(abs: string): boolean {
  if (!abs.endsWith('.md')) return false
  if (EXCLUDED_NAMES.has(path.basename(abs).toLowerCase())) return false
  const vault = vaultRoot()
  if (abs === vault || abs.startsWith(vault + path.sep)) return false
  if (/\/(node_modules|\.git|\.idea|build|dist)\//.test(abs)) return false
  return true
}

/** Best-effort project name: nearest enclosing git repo, else parent dir name. */
export function projectOf(abs: string): string {
  let dir = path.dirname(abs)
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return path.basename(dir)
    dir = path.dirname(dir)
  }
  return path.basename(path.dirname(abs))
}

/**
 * Find files matching a basename across scan roots (root *.md + immediate
 * subdirectory root *.md — same coverage as scan()). Lets the UI resolve a
 * browser-dropped file (which has no path) back to its likely source on disk.
 */
export function findByName(name: string): Array<{ path: string; project: string }> {
  const config = loadConfig()
  const hits: Array<{ path: string; project: string }> = []
  const consider = (abs: string) => {
    if (path.basename(abs) === name && isCandidateFile(abs)) hits.push({ path: abs, project: projectOf(abs) })
  }
  for (const rootRaw of config.scanRoots) {
    const root = expandTilde(rootRaw)
    if (!fs.existsSync(root)) continue
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const abs = path.join(root, entry.name)
      if (entry.isFile()) consider(abs)
      else if (entry.isDirectory() && !entry.name.startsWith('.')) {
        try {
          for (const sub of fs.readdirSync(abs, { withFileTypes: true })) {
            if (sub.isFile()) consider(path.join(abs, sub.name))
          }
        } catch {
          continue
        }
      }
    }
  }
  return hits
}

/**
 * Sweep scan roots for orphan markdown docs. For each root we look at the
 * root's own *.md files plus each immediate subdirectory's root-level *.md —
 * enough to cover ~/.claude/plans/*.md and ~/workspace/<repo>/*.md without
 * crawling entire repos.
 */
export function scan(): { added: number; examined: number } {
  const config = loadConfig()
  let added = 0
  let examined = 0

  const consider = (abs: string) => {
    examined++
    if (!isCandidateFile(abs)) return
    if (addCandidate({ path: abs, project: projectOf(abs), origin: 'scan' })) added++
  }

  for (const rootRaw of config.scanRoots) {
    const root = expandTilde(rootRaw)
    if (!fs.existsSync(root)) continue
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const abs = path.join(root, entry.name)
      if (entry.isFile()) consider(abs)
      else if (entry.isDirectory() && !entry.name.startsWith('.')) {
        let subEntries: fs.Dirent[]
        try {
          subEntries = fs.readdirSync(abs, { withFileTypes: true })
        } catch {
          continue
        }
        for (const sub of subEntries) {
          if (sub.isFile()) consider(path.join(abs, sub.name))
        }
      }
    }
  }
  return { added, examined }
}
