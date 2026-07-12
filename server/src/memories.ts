import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import matter from 'gray-matter'
import { expandTilde } from './config.js'

export interface MemoryFile {
  file: string
  title: string
  description: string
  mtime: number
}

export interface MemoryProject {
  slug: string
  displayName: string
  dir: string
  count: number
  latestMtime: number
  hasIndex: boolean
  files: MemoryFile[]
}

function projectsRoot(): string {
  return expandTilde('~/.claude/projects')
}

function titleOf(content: string, fallback: string): string {
  const h1 = content.match(/^#\s+(.+)$/m)
  return h1 ? h1[1].trim() : fallback
}

function readMemoryFile(dir: string, file: string): MemoryFile | null {
  try {
    const abs = path.join(dir, file)
    const raw = fs.readFileSync(abs, 'utf8')
    const parsed = matter(raw)
    const fallback = path.basename(file, '.md')
    return {
      file,
      title: (parsed.data?.name as string | undefined) ?? titleOf(parsed.content, fallback),
      description: (parsed.data?.description as string | undefined) ?? '',
      mtime: fs.statSync(abs).mtimeMs,
    }
  } catch {
    return null
  }
}

export function listMemoryProjects(): MemoryProject[] {
  const root = projectsRoot()
  if (!fs.existsSync(root)) return []
  const homePrefix = os.homedir().replaceAll('/', '-')
  const out: MemoryProject[] = []

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const memoryDir = path.join(root, entry.name, 'memory')
    if (!fs.existsSync(memoryDir)) continue

    let mdFiles: string[]
    try {
      mdFiles = fs.readdirSync(memoryDir).filter((f) => f.endsWith('.md'))
    } catch {
      continue
    }
    if (mdFiles.length === 0) continue

    const hasIndex = mdFiles.includes('MEMORY.md')
    const files = mdFiles
      .filter((f) => f !== 'MEMORY.md')
      .map((f) => readMemoryFile(memoryDir, f))
      .filter((f): f is MemoryFile => f !== null)
    if (files.length === 0) continue

    const displayName = entry.name.startsWith(homePrefix) ? entry.name.slice(homePrefix.length).replace(/^-+/, '') : entry.name

    out.push({
      slug: entry.name,
      displayName,
      dir: memoryDir,
      count: files.length,
      latestMtime: Math.max(...files.map((f) => f.mtime)),
      hasIndex,
      files: files.sort((a, b) => b.mtime - a.mtime),
    })
  }

  return out.sort((a, b) => b.latestMtime - a.latestMtime)
}

const SEGMENT_RE = /^[^/\\]+$/

function assertSafeSegment(segment: string, label: string): void {
  if (!SEGMENT_RE.test(segment) || segment === '..' || segment === '.') {
    throw new Error(`Invalid ${label}: ${segment}`)
  }
}

export function readMemory(slug: string, file: string): { content: string; body: string; frontmatter: Record<string, unknown>; absPath: string } {
  assertSafeSegment(slug, 'slug')
  assertSafeSegment(file, 'file')
  const memoryDir = path.join(projectsRoot(), slug, 'memory')
  const abs = path.resolve(memoryDir, file)
  if (abs !== memoryDir && !abs.startsWith(memoryDir + path.sep)) {
    throw new Error('Path escapes memory directory')
  }
  const content = fs.readFileSync(abs, 'utf8')
  const parsed = matter(content)
  return { content, body: parsed.content, frontmatter: parsed.data ?? {}, absPath: abs }
}
