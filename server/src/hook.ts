import fs from 'node:fs'
import { isCandidateFile, projectOf } from './scanner.js'
import { addCandidate } from './inbox.js'

/**
 * Claude Code PostToolUse hook entrypoint. Reads the hook event JSON from
 * stdin; when the Write targeted a markdown file that looks like a plan or
 * doc (outside the vault), records it in the PlanKeep inbox. Always exits 0
 * and prints nothing so it never interferes with the session.
 */
export async function runHook(): Promise<void> {
  try {
    const raw = fs.readFileSync(0, 'utf8')
    const event = JSON.parse(raw)
    const filePath: string | undefined = event?.tool_input?.file_path
    if (!filePath || !isCandidateFile(filePath) || !fs.existsSync(filePath)) return
    addCandidate({ path: filePath, project: projectOf(filePath), origin: 'hook' })
  } catch {
    // never fail the hook
  }
}
