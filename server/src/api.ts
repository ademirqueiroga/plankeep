import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { expandTilde, loadConfig, saveConfig, type VaultEntry } from './config.js'
import * as vault from './vault.js'
import * as gitops from './gitops.js'
import * as queue from './queue.js'
import * as inbox from './inbox.js'
import * as scanner from './scanner.js'
import * as ai from './ai.js'
import * as memories from './memories.js'
import * as activity from './activity.js'
import { onVaultActivated } from './startup.js'

export function buildApp(): Hono {
  const app = new Hono()
  const api = new Hono()

  api.onError((err, c) => c.json({ error: err.message }, 500))

  // ----- meta / settings -----
  api.get('/meta', (c) => {
    const cliPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cli.js')
    const config = loadConfig()
    return c.json({
      vaultPath: vault.vaultRoot(),
      vaults: config.vaults,
      activeVault: config.activeVault,
      config,
      mcp: { node: process.execPath, cliPath: fs.existsSync(cliPath) ? cliPath : null },
    })
  })
  api.put('/settings', async (c) => {
    const body = await c.req.json()
    const config = { ...loadConfig(), ...body, git: { ...loadConfig().git, ...(body.git ?? {}) } }
    saveConfig(config)
    return c.json({ config })
  })

  // ----- vault registry -----
  api.get('/vaults', (c) => {
    const config = loadConfig()
    return c.json({ vaults: config.vaults, active: config.activeVault })
  })
  api.post('/vaults', async (c) => {
    const { name, path: rawPath, cloneUrl } = await c.req.json()
    if (typeof name !== 'string' || !name.trim()) return c.json({ error: 'Vault name is required' }, 400)
    if (typeof rawPath !== 'string' || !rawPath.trim()) return c.json({ error: 'Vault path is required' }, 400)
    const config = loadConfig()
    if (config.vaults.some((v) => v.name === name)) return c.json({ error: `A vault named "${name}" already exists` }, 400)
    const target = expandTilde(rawPath.trim())
    for (const v of config.vaults) {
      const existing = expandTilde(v.path)
      if (target === existing || target.startsWith(existing + path.sep) || existing.startsWith(target + path.sep)) {
        return c.json({ error: `Path overlaps existing vault "${v.name}" (${existing})` }, 400)
      }
    }
    try {
      if (cloneUrl && !fs.existsSync(target)) {
        // freshly cloned from a remote — already in sync with collaborators, don't re-scaffold/commit over it
        await gitops.cloneRepo(cloneUrl, target)
      } else {
        await gitops.initRepoAt(target)
      }
    } catch (e) {
      return c.json({ error: `git clone failed: ${(e as Error).message}` }, 400)
    }
    const entry: VaultEntry = { name: name.trim(), path: rawPath.trim() }
    config.vaults.push(entry)
    saveConfig(config)
    return c.json({ vaults: config.vaults, active: config.activeVault })
  })
  api.put('/vaults/active', async (c) => {
    const { name } = await c.req.json()
    const config = loadConfig()
    if (!config.vaults.some((v) => v.name === name)) return c.json({ error: `No vault named "${name}"` }, 400)
    config.activeVault = name
    saveConfig(config)
    await onVaultActivated()
    return c.json({ vaults: config.vaults, active: config.activeVault })
  })
  api.delete('/vaults/:name', (c) => {
    const name = c.req.param('name')
    const config = loadConfig()
    if (config.activeVault === name) return c.json({ error: 'Switch to another vault before removing this one' }, 400)
    if (config.vaults.length <= 1) return c.json({ error: 'Cannot remove the last vault' }, 400)
    if (!config.vaults.some((v) => v.name === name)) return c.json({ error: `No vault named "${name}"` }, 400)
    config.vaults = config.vaults.filter((v) => v.name !== name)
    saveConfig(config)
    return c.json({ vaults: config.vaults, active: config.activeVault })
  })
  api.patch('/vaults/:name', async (c) => {
    const name = c.req.param('name')
    const patch = await c.req.json()
    const config = loadConfig()
    const entry = config.vaults.find((v) => v.name === name)
    if (!entry) return c.json({ error: `No vault named "${name}"` }, 400)
    if (typeof patch.name === 'string' && patch.name.trim() && patch.name !== entry.name) {
      if (config.vaults.some((v) => v.name === patch.name)) return c.json({ error: `A vault named "${patch.name}" already exists` }, 400)
      if (config.activeVault === entry.name) config.activeVault = patch.name
      entry.name = patch.name.trim()
    }
    if (typeof patch.remote === 'string') entry.remote = patch.remote || undefined
    if (typeof patch.autoPush === 'boolean') entry.autoPush = patch.autoPush
    saveConfig(config)
    if (typeof patch.remote === 'string' && config.activeVault === entry.name) await gitops.setRemote(patch.remote)
    return c.json({ vaults: config.vaults, active: config.activeVault })
  })

  // ----- tree & docs -----
  api.get('/tree', (c) => c.json(vault.tree()))
  api.get('/docs', (c) => c.json(vault.listDocs()))
  api.get('/doc', (c) => {
    const rel = c.req.query('path') ?? ''
    const doc = vault.readDoc(rel)
    const abs = vault.safePath(rel)
    const record = activity.lastClaudeWrite(abs)
    // both directions of the derived-from link, resolved by id so moves and renames don't break them
    const all = vault.listDocs()
    const parent = doc.meta.derivedFrom ? all.find((d) => d.meta.id === doc.meta.derivedFrom) : undefined
    const derived = all.filter((d) => d.meta.derivedFrom === doc.meta.id).map((d) => ({ path: d.path, title: d.title }))
    return c.json({
      path: rel,
      absPath: abs,
      ...doc,
      mtime: fs.statSync(abs).mtimeMs,
      claudeActivity: record ? { at: record.at, sessionId: record.sessionId, cwd: record.cwd } : undefined,
      parent: parent ? { path: parent.path, title: parent.title } : undefined,
      derived,
    })
  })
  api.put('/doc', async (c) => {
    const { path: rel, content, body } = await c.req.json()
    if (typeof body === 'string') vault.updateBody(rel, body)
    else vault.saveRawDoc(rel, content)
    const autoStatus = vault.autoStatusFor(rel)
    if (autoStatus) vault.updateMeta(rel, { status: autoStatus })
    await gitops.commitAll(`edit: ${rel}${autoStatus ? ` (auto-status: ${autoStatus})` : ''}`)
    return c.json(vault.summarize(rel))
  })
  api.post('/doc/meta', async (c) => {
    const { path: rel, ...patch } = await c.req.json()
    if (patch.derivedFrom) {
      patch.derivedFrom = vault.resolveDocId(patch.derivedFrom)
      const self = vault.readDoc(rel).meta.id
      if (vault.createsCycle(self, patch.derivedFrom, vault.listDocs())) {
        return c.json({ error: 'That link would create a cycle — a document cannot derive from its own descendant.' }, 400)
      }
    }
    const meta = vault.updateMeta(rel, patch)
    // archiving takes the doc out of circulation — Up Next should never hold one
    if (patch.status === 'archived') queue.removeFromQueue(rel)
    await gitops.commitAll(`meta: ${rel}`)
    return c.json(meta)
  })
  const AI_JOB_BLOCK = ai.AI_JOB_BLOCK

  /** Best-effort relative symlink at `fromAbs` pointing to `toAbs`; skips silently if something already exists there. */
  const leaveLinkAt = (fromAbs: string, toAbs: string) => {
    if (fs.existsSync(fromAbs)) return
    try {
      // realpath the containing dir first — see the matching comment in vault.importFile.
      const realDir = fs.realpathSync(path.dirname(fromAbs))
      fs.symlinkSync(path.relative(realDir, toAbs), fromAbs)
    } catch {
      // best-effort — the move itself already succeeded
    }
  }

  api.post('/docs/move', async (c) => {
    const { from, to, leaveLink } = await c.req.json()
    if (ai.hasRunningJobFor(from)) return c.json({ error: AI_JOB_BLOCK }, 409)
    const fromAbs = vault.safePath(from)
    vault.moveDoc(from, to)
    queue.renameInQueue(from, to)
    if (leaveLink) leaveLinkAt(fromAbs, vault.safePath(to))
    await gitops.commitAll(`move: ${from} -> ${to}`)
    return c.json({ ok: true })
  })
  api.post('/docs/delete', async (c) => {
    const { path: rel } = await c.req.json()
    if (ai.hasRunningJobFor(rel)) return c.json({ error: AI_JOB_BLOCK }, 409)
    vault.deleteDoc(rel)
    queue.removeFromQueue(rel)
    await gitops.commitAll(`delete: ${rel}`)
    return c.json({ ok: true })
  })
  api.post('/folders', async (c) => {
    const { path: rel } = await c.req.json()
    vault.createFolder(rel)
    await gitops.commitAll(`folder: ${rel}`)
    return c.json({ ok: true })
  })
  api.post('/folders/delete', async (c) => {
    const { path: rel } = await c.req.json()
    if (ai.hasRunningJobFor(rel)) return c.json({ error: AI_JOB_BLOCK }, 409)
    vault.deleteFolder(rel)
    await gitops.commitAll(`delete folder: ${rel}`)
    return c.json({ ok: true })
  })
  api.post('/folders/rename', async (c) => {
    const { from, to, leaveLink } = await c.req.json()
    if (ai.hasRunningJobFor(from)) return c.json({ error: AI_JOB_BLOCK }, 409)
    const fromAbs = vault.safePath(from)
    vault.renameFolder(from, to)
    queue.renamePrefixInQueue(from, to)
    if (leaveLink) leaveLinkAt(fromAbs, vault.safePath(to))
    await gitops.commitAll(`rename folder: ${from} -> ${to}`)
    return c.json({ ok: true })
  })
  api.get('/folders/stats', (c) => c.json(vault.folderStats(c.req.query('path') ?? '')))

  // ----- Claude activity (presence sensor for move safety) -----
  const activityResponse = (record: activity.ActivityRecord | null, extra?: { path?: string }) => ({
    lastClaudeWrite: record?.at ?? null,
    sessionId: record?.sessionId,
    cwd: record?.cwd,
    tool: record?.tool,
    ...extra,
  })
  api.get('/activity', (c) => {
    const rel = c.req.query('path')
    const folder = c.req.query('folder')
    const abs = c.req.query('abs')
    if (abs) return c.json(activityResponse(activity.lastClaudeWrite(abs)))
    if (folder !== undefined) {
      const hit = activity.lastClaudeWriteUnder(vault.safePath(folder))
      return c.json(activityResponse(hit?.record ?? null, { path: hit ? path.relative(vault.vaultRoot(), hit.path) : undefined }))
    }
    return c.json(activityResponse(activity.lastClaudeWrite(vault.safePath(rel ?? ''))))
  })

  // ----- desktop niceties (server runs on the user's machine) -----
  api.post('/reveal', async (c) => {
    const { path: rel, absPath } = await c.req.json()
    const target = absPath ?? vault.safePath(rel)
    const cmd = process.platform === 'darwin' ? ['open', '-R', target] : ['xdg-open', path.dirname(target)]
    execFile(cmd[0], cmd.slice(1))
    return c.json({ ok: true })
  })
  api.get('/resolve-source', (c) => c.json(scanner.findByName(c.req.query('name') ?? '')))

  // ----- import -----
  api.post('/import', async (c) => {
    const { sourcePath, folder, mode, project, leaveLink } = await c.req.json()
    const result = vault.importFile(sourcePath, { folder, mode, project, leaveLink })
    inbox.setStatus(sourcePath, 'imported')
    await gitops.commitAll(`import: ${result.path}`)
    return c.json(result)
  })
  api.post('/import-content', async (c) => {
    const { name, content, folder, type } = await c.req.json()
    const rel = vault.importContent(name, content, { folder, type })
    await gitops.commitAll(`import: ${rel}`)
    return c.json({ path: rel })
  })

  // ----- search -----
  api.get('/search', (c) => c.json(vault.search(c.req.query('q') ?? '')))
  api.get('/labels', (c) => c.json(vault.labelCounts()))

  // ----- Claude memories (read-only browser) -----
  api.get('/memories', (c) => c.json(memories.listMemoryProjects()))
  api.get('/memories/doc', (c) => {
    const slug = c.req.query('slug') ?? ''
    const file = c.req.query('file') ?? ''
    return c.json(memories.readMemory(slug, file))
  })

  // ----- queue -----
  api.get('/queue', (c) => c.json(queue.queueDocs()))
  api.put('/queue', async (c) => {
    const { paths } = await c.req.json()
    queue.setQueue(paths)
    await gitops.commitAll('queue: reorder')
    return c.json(queue.queueDocs())
  })
  api.post('/queue/add', async (c) => {
    const { path: rel, position } = await c.req.json()
    queue.addToQueue(rel, position)
    await gitops.commitAll(`queue: add ${rel}`)
    return c.json(queue.queueDocs())
  })
  api.post('/queue/remove', async (c) => {
    const { path: rel } = await c.req.json()
    queue.removeFromQueue(rel)
    await gitops.commitAll(`queue: remove ${rel}`)
    return c.json(queue.queueDocs())
  })

  // ----- inbox & scan -----
  api.get('/inbox', (c) => c.json(inbox.pendingEnriched().filter((i) => !scanner.isExcluded(i.path))))
  api.post('/inbox/dismiss', async (c) => {
    const { path: p } = await c.req.json()
    inbox.setStatus(p, 'dismissed')
    return c.json({ ok: true })
  })
  api.post('/scan', async (c) => {
    const result = scanner.scan()
    const removed = vault.cleanStaleLinks()
    if (removed > 0) await gitops.commitAll(`cleanup: ${removed} stale link(s)`)
    return c.json(result)
  })

  // ----- git -----
  api.get('/git/status', async (c) => c.json(await gitops.gitState()))
  api.get('/git/log', async (c) => c.json(await gitops.log()))
  api.post('/git/sync', async (c) => c.json(await gitops.sync()))
  api.post('/git/create-remote', async (c) => {
    const { name } = await c.req.json()
    return c.json(await gitops.createGithubRepo(name || 'plans-vault'))
  })

  // ----- AI actions -----
  api.post('/ai/run', async (c) => {
    const { path: rel, action } = await c.req.json()
    return c.json(ai.startJob(action, rel))
  })
  api.get('/ai/jobs', (c) => c.json(ai.listJobs()))
  api.get('/ai/jobs/:id', (c) => {
    const job = ai.getJob(c.req.param('id'))
    return job ? c.json(job) : c.json({ error: 'not found' }, 404)
  })

  app.route('/api', api)

  // static SPA (built web/dist), resolved relative to this file: server/dist -> web/dist
  const here = path.dirname(fileURLToPath(import.meta.url))
  const webDist = path.resolve(here, '../../web/dist')
  if (fs.existsSync(webDist)) {
    const relRoot = path.relative(process.cwd(), webDist)
    app.use('/*', serveStatic({ root: relRoot }))
    app.get('*', (c) => c.html(fs.readFileSync(path.join(webDist, 'index.html'), 'utf8')))
  }
  return app
}
