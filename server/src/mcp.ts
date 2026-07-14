import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import * as vault from './vault.js'
import * as gitops from './gitops.js'
import * as queue from './queue.js'
import * as inbox from './inbox.js'
import * as scanner from './scanner.js'
import * as ai from './ai.js'
import * as activity from './activity.js'
import { loadConfig, vaultRootByName } from './config.js'

const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] })

const VAULT_PARAM_DESC = 'Name of a registered vault to use instead of the active one (see the user\'s vault registry). Omit to use whichever vault is active in the UI.'

export async function runMcp(): Promise<void> {
  await gitops.ensureVaultRepo()
  const server = new McpServer({ name: 'plankeep', version: '0.1.0' })

  server.tool(
    'list_documents',
    'List all documents in the PlanKeep vault (plans, findings, exploration/research notes) with metadata, checkbox progress and vault-relative paths.',
    { vault: z.string().optional().describe(VAULT_PARAM_DESC) },
    async ({ vault: vaultName }) => text(vault.listDocs(vaultName ? vaultRootByName(vaultName) : undefined)),
  )

  server.tool(
    'get_document',
    'Read one vault document by its vault-relative path. Returns full markdown content, metadata and absolute path.',
    {
      path: z.string().describe('Vault-relative path, e.g. "my-app/feature-plan.md"'),
      vault: z.string().optional().describe(VAULT_PARAM_DESC),
    },
    async ({ path: rel, vault: vaultName }) => {
      const root = vaultName ? vaultRootByName(vaultName) : undefined
      const doc = vault.readDoc(rel, root)
      return text({ path: rel, absPath: vault.safePath(rel, root), ...doc })
    },
  )

  server.tool(
    'save_document',
    'Create or update a document in the vault. USE THIS instead of writing plan/findings/research markdown files into a code repository — the vault is the centralized, git-backed home for such docs. Folder should usually be the project name the doc relates to.',
    {
      name: z.string().describe('File name, e.g. "redesign-plan.md"'),
      content: z.string().describe('Full markdown content (front-matter optional; PlanKeep adds its own metadata)'),
      folder: z.string().optional().describe('Vault folder, usually the related project name, e.g. "my-app"'),
      type: z.enum(['plan', 'findings', 'exploration', 'research', 'note']).optional(),
      overwritePath: z.string().optional().describe('If updating an existing doc, its current vault-relative path'),
      vault: z.string().optional().describe(VAULT_PARAM_DESC),
    },
    async ({ name, content, folder, type, overwritePath, vault: vaultName }) => {
      const root = vaultName ? vaultRootByName(vaultName) : undefined
      let rel: string
      if (overwritePath) {
        vault.saveRawDoc(overwritePath, content, root)
        rel = overwritePath
        if (type) vault.updateMeta(rel, { type }, root)
      } else {
        rel = vault.importContent(name, content, { folder, type, project: folder }, root)
      }
      const autoStatus = vault.autoStatusFor(rel, root)
      if (autoStatus) vault.updateMeta(rel, { status: autoStatus }, root)
      await gitops.commitAll(`mcp save: ${rel}${autoStatus ? ` (auto-status: ${autoStatus})` : ''}`)
      return text({ path: rel, absPath: vault.safePath(rel, root) })
    },
  )

  server.tool(
    'import_file',
    'Import an existing markdown file from disk into the vault (copy or move per argument/config). Auto-files it under a folder named after the source project unless folder is given.',
    {
      sourcePath: z.string().describe('Absolute path of the markdown file to import'),
      folder: z.string().optional(),
      mode: z.enum(['copy', 'move']).optional(),
      project: z.string().optional(),
      leaveLink: z.boolean().optional().describe('When mode is move, leave a symlink at the original location pointing into the vault (default false)'),
    },
    async ({ sourcePath, folder, mode, project, leaveLink }) => {
      const result = vault.importFile(sourcePath, { folder, mode, project, leaveLink })
      inbox.setStatus(sourcePath, 'imported')
      await gitops.commitAll(`import: ${result.path}`)
      return text(result)
    },
  )

  server.tool(
    'search_documents',
    'Full-text search across the vault (titles, paths, tags, content). Returns matching docs with snippets.',
    { query: z.string(), vault: z.string().optional().describe(VAULT_PARAM_DESC) },
    async ({ query, vault: vaultName }) => text(vault.search(query, vaultName ? vaultRootByName(vaultName) : undefined)),
  )

  server.tool(
    'set_metadata',
    'Update a document\'s type, status (draft|active|waiting|done|archived) or tags.',
    {
      path: z.string(),
      type: z.enum(['plan', 'findings', 'exploration', 'research', 'note']).optional(),
      status: z.enum(['draft', 'active', 'waiting', 'done', 'archived']).optional(),
      tags: z.array(z.string()).optional(),
    },
    async ({ path: rel, ...patch }) => {
      const meta = vault.updateMeta(rel, patch)
      await gitops.commitAll(`meta: ${rel}`)
      return text(meta)
    },
  )

  server.tool(
    'list_vaults',
    'List the user\'s registered PlanKeep vaults (name + path) and which one is currently active in the UI. Use a vault name with the `vault` param on other tools to target a non-active vault.',
    {},
    async () => {
      const config = loadConfig()
      return text({ active: config.activeVault, vaults: config.vaults.map((v) => ({ name: v.name, path: v.path })) })
    },
  )

  server.tool(
    'report_plan_state',
    'Reflect your implementation state on the plan you are executing. Call with working when you start, waiting whenever you stop before completion (user question, blocker, end of session), done when finished. Keep it current — the user reads this state in the PlanKeep UI.',
    {
      path: z.string().describe('Vault-relative path of the plan being worked'),
      state: z.enum(['working', 'waiting', 'done']).describe('working = actively implementing now; waiting = stopped (needs human input / blocked / handing off); done = implementation finished and verified'),
      note: z.string().max(300).optional().describe('One line on why — e.g. "waiting: needs the user to approve the API change"'),
      vault: z.string().optional().describe('Vault name (see list_vaults); defaults to the active vault'),
    },
    async ({ path: rel, state, note, vault: vaultName }) => {
      if (ai.hasRunningJobFor(rel)) throw new Error(ai.AI_JOB_BLOCK)
      const root = vaultName ? vaultRootByName(vaultName) : undefined
      const status = state === 'working' ? 'active' : state === 'waiting' ? 'waiting' : 'done'
      const meta = vault.updateMeta(rel, { status, agentNote: note }, root)
      activity.recordClaudeWrite(vault.safePath(rel, root), { tool: 'mcp' })
      await gitops.commitAll(`agent-state: ${state} — ${rel}`)
      return text(meta)
    },
  )

  server.tool(
    'get_up_next_queue',
    'Get the ordered "up next" work queue — what the user plans to tackle next, first item first.',
    {},
    async () => text(queue.queueDocs()),
  )

  server.tool(
    'add_to_up_next',
    'Add a vault document to the "up next" queue (optionally at a position, 0 = first).',
    { path: z.string(), position: z.number().optional() },
    async ({ path: rel, position }) => {
      queue.addToQueue(rel, position)
      await gitops.commitAll(`queue: add ${rel}`)
      return text(queue.queueDocs())
    },
  )

  server.tool(
    'list_inbox',
    'List pending inbox candidates: markdown files detected in repos/Claude sessions that are not yet imported into the vault.',
    {},
    async () => text(inbox.pending().filter((i) => !scanner.isExcluded(i.path))),
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
