import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { loadConfig, saveConfig } from './config.js'
import * as vault from './vault.js'
import * as gitops from './gitops.js'
import * as queue from './queue.js'
import * as inbox from './inbox.js'
import * as scanner from './scanner.js'
import * as ai from './ai.js'
import * as memories from './memories.js'

export function buildApp(): Hono {
  const app = new Hono()
  const api = new Hono()

  api.onError((err, c) => c.json({ error: err.message }, 500))

  // ----- meta / settings -----
  api.get('/meta', (c) =>
    c.json({
      vaultPath: vault.vaultRoot(),
      config: loadConfig(),
    }),
  )
  api.put('/settings', async (c) => {
    const body = await c.req.json()
    const config = { ...loadConfig(), ...body, git: { ...loadConfig().git, ...(body.git ?? {}) } }
    saveConfig(config)
    if (body.git?.remote) await gitops.setRemote(body.git.remote)
    return c.json({ config })
  })

  // ----- tree & docs -----
  api.get('/tree', (c) => c.json(vault.tree()))
  api.get('/docs', (c) => c.json(vault.listDocs()))
  api.get('/doc', (c) => {
    const rel = c.req.query('path') ?? ''
    const doc = vault.readDoc(rel)
    return c.json({ path: rel, absPath: vault.safePath(rel), ...doc })
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
    const meta = vault.updateMeta(rel, patch)
    await gitops.commitAll(`meta: ${rel}`)
    return c.json(meta)
  })
  api.post('/docs/move', async (c) => {
    const { from, to } = await c.req.json()
    vault.moveDoc(from, to)
    queue.renameInQueue(from, to)
    await gitops.commitAll(`move: ${from} -> ${to}`)
    return c.json({ ok: true })
  })
  api.post('/docs/delete', async (c) => {
    const { path: rel } = await c.req.json()
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
    vault.deleteFolder(rel)
    await gitops.commitAll(`delete folder: ${rel}`)
    return c.json({ ok: true })
  })
  api.post('/folders/rename', async (c) => {
    const { from, to } = await c.req.json()
    vault.renameFolder(from, to)
    queue.renamePrefixInQueue(from, to)
    await gitops.commitAll(`rename folder: ${from} -> ${to}`)
    return c.json({ ok: true })
  })
  api.get('/folders/stats', (c) => c.json(vault.folderStats(c.req.query('path') ?? '')))

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
    const { sourcePath, folder, mode, project } = await c.req.json()
    const result = vault.importFile(sourcePath, { folder, mode, project })
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
  api.post('/scan', (c) => c.json(scanner.scan()))

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
