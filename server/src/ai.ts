import crypto from 'node:crypto'
import fs from 'node:fs'
import { execFile } from 'node:child_process'
import { readDoc, saveRawDoc, safePath } from './vault.js'
import { commitAll } from './gitops.js'

export type AiAction = 'improve' | 'checkboxify' | 'refresh'

export interface AiJob {
  id: string
  action: AiAction
  path: string
  status: 'running' | 'done' | 'error'
  startedAt: string
  finishedAt?: string
  error?: string
}

const jobs = new Map<string, AiJob>()

const COMMON_RULES = `
Rules:
- Output ONLY the complete updated markdown document, nothing else (no preamble, no code fences around the whole document).
- Preserve the YAML front-matter block exactly as-is, including the plankeep key.
- Preserve all checked checkboxes ([x]) — never un-check completed work.`

function promptFor(action: AiAction, content: string, sourceProject?: string): string {
  switch (action) {
    case 'improve':
      return `You are improving a planning/notes markdown document for readability. Reorganize headings, tighten prose, fix formatting, add a short summary at the top if missing. Do NOT drop information.${COMMON_RULES}\n\nDocument:\n\n${content}`
    case 'checkboxify':
      return `Convert the phases/steps/tasks in this markdown plan into GitHub-style task lists ("- [ ] item"), preserving structure and any items already marked done as "- [x]". Leave non-actionable prose untouched.${COMMON_RULES}\n\nDocument:\n\n${content}`
    case 'refresh':
      return `You are inside the repository "${sourceProject ?? 'unknown'}" that this plan refers to. Cross-check the plan below against the CURRENT state of the repository (read files, grep, check git log as needed). Update checkbox states for steps already implemented, and add a short "## Status (auto-refreshed)" section at the top summarizing what is done, in progress, and not started, citing file paths as evidence.${COMMON_RULES}\n\nDocument:\n\n${content}`
  }
}

/** Locate the source repo for `refresh` so claude -p can read it. */
function cwdFor(action: AiAction, rel: string): { cwd: string; project?: string } {
  const { meta } = readDoc(rel)
  if (action === 'refresh' && meta.source?.path) {
    const dir = meta.source.path.replace(/\/[^/]+$/, '')
    if (fs.existsSync(dir)) return { cwd: dir, project: meta.source.project }
  }
  return { cwd: safePath('').toString() }
}

export function startJob(action: AiAction, rel: string): AiJob {
  const { content } = readDoc(rel)
  const { cwd, project } = cwdFor(action, rel)
  const job: AiJob = {
    id: crypto.randomUUID(),
    action,
    path: rel,
    status: 'running',
    startedAt: new Date().toISOString(),
  }
  jobs.set(job.id, job)

  const args = ['-p', promptFor(action, content, project), '--output-format', 'text']
  if (action === 'refresh') args.push('--allowedTools', 'Read,Grep,Glob,Bash(git log:*),Bash(git diff:*)')

  execFile('claude', args, { cwd, maxBuffer: 32 * 1024 * 1024, timeout: 15 * 60_000 }, async (err, stdout) => {
    if (err) {
      job.status = 'error'
      job.error = err.message.split('\n')[0]
    } else {
      const output = stdout.trim()
      // sanity guard: refuse suspiciously short/empty output instead of clobbering the doc
      if (output.length < 40 || !output.startsWith('---')) {
        job.status = 'error'
        job.error = 'Model output did not look like the updated document; original left untouched.'
      } else {
        saveRawDoc(rel, output + '\n')
        await commitAll(`ai(${action}): ${rel}`)
        job.status = 'done'
      }
    }
    job.finishedAt = new Date().toISOString()
  })
  return job
}

export function getJob(id: string): AiJob | undefined {
  return jobs.get(id)
}

export function listJobs(): AiJob[] {
  return [...jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 20)
}
