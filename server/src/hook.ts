import fs from 'node:fs'
import path from 'node:path'
import { isCandidateFile, projectOf } from './scanner.js'
import { addCandidate } from './inbox.js'
import { recordClaudeWrite } from './activity.js'
import { vaultRoot } from './vault.js'

/**
 * Claude Code PostToolUse hook entrypoint. Reads the hook event JSON from
 * stdin. A Write/Edit targeting a markdown file under the vault records
 * activity (so PlanKeep can warn on moves of in-use docs); anything else
 * that looks like a plan or doc outside the vault feeds the inbox. Always
 * exits 0 and prints nothing so it never interferes with the session.
 */
export async function runHook(): Promise<void> {
  try {
    const raw = fs.readFileSync(0, 'utf8')
    const event = JSON.parse(raw)
    const filePath: string | undefined = event?.tool_input?.file_path
    if (!filePath || !fs.existsSync(filePath)) return

    if (filePath.endsWith('.md')) {
      const vault = vaultRoot()
      if (filePath === vault || filePath.startsWith(vault + path.sep)) {
        recordClaudeWrite(filePath)
        return
      }
    }

    if (!isCandidateFile(filePath)) return
    addCandidate({ path: filePath, project: projectOf(filePath), origin: 'hook' })
  } catch {
    // never fail the hook
  }
}
