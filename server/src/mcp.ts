import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import * as vault from './vault.js'
import * as gitops from './gitops.js'
import * as queue from './queue.js'
import * as inbox from './inbox.js'

const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] })

export async function runMcp(): Promise<void> {
  await gitops.ensureVaultRepo()
  const server = new McpServer({ name: 'plankeep', version: '0.1.0' })

  server.tool(
    'list_documents',
    'List all documents in the PlanKeep vault (plans, findings, exploration/research notes) with metadata, checkbox progress and vault-relative paths.',
    {},
    async () => text(vault.listDocs()),
  )

  server.tool(
    'get_document',
    'Read one vault document by its vault-relative path. Returns full markdown content, metadata and absolute path.',
    { path: z.string().describe('Vault-relative path, e.g. "my-app/feature-plan.md"') },
    async ({ path: rel }) => {
      const doc = vault.readDoc(rel)
      return text({ path: rel, absPath: vault.safePath(rel), ...doc })
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
    },
    async ({ name, content, folder, type, overwritePath }) => {
      let rel: string
      if (overwritePath) {
        vault.saveRawDoc(overwritePath, content)
        rel = overwritePath
      } else {
        rel = vault.importContent(name, content, { folder, type, project: folder })
      }
      const autoStatus = vault.autoStatusFor(rel)
      if (autoStatus) vault.updateMeta(rel, { status: autoStatus })
      await gitops.commitAll(`mcp save: ${rel}${autoStatus ? ` (auto-status: ${autoStatus})` : ''}`)
      return text({ path: rel, absPath: vault.safePath(rel) })
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
    },
    async ({ sourcePath, folder, mode, project }) => {
      const result = vault.importFile(sourcePath, { folder, mode, project })
      inbox.setStatus(sourcePath, 'imported')
      await gitops.commitAll(`import: ${result.path}`)
      return text(result)
    },
  )

  server.tool(
    'search_documents',
    'Full-text search across the vault (titles, paths, tags, content). Returns matching docs with snippets.',
    { query: z.string() },
    async ({ query }) => text(vault.search(query)),
  )

  server.tool(
    'set_metadata',
    'Update a document\'s type, status (draft|active|done|archived) or tags.',
    {
      path: z.string(),
      type: z.enum(['plan', 'findings', 'exploration', 'research', 'note']).optional(),
      status: z.enum(['draft', 'active', 'done', 'archived']).optional(),
      tags: z.array(z.string()).optional(),
    },
    async ({ path: rel, ...patch }) => {
      const meta = vault.updateMeta(rel, patch)
      await gitops.commitAll(`meta: ${rel}`)
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
    async () => text(inbox.pending()),
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
