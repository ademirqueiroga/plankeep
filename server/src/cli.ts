#!/usr/bin/env node
import { serve } from '@hono/node-server'
import { loadConfig } from './config.js'

const command = process.argv[2] ?? 'serve'

async function main(): Promise<void> {
  switch (command) {
    case 'serve': {
      const { buildApp } = await import('./api.js')
      const { ensureVaultRepo, commitAll } = await import('./gitops.js')
      const { cleanStaleLinks } = await import('./vault.js')
      const { sweepAutoActive } = await import('./autostatus.js')
      await ensureVaultRepo()
      const removed = cleanStaleLinks()
      if (removed > 0) await commitAll(`cleanup: ${removed} stale link(s)`)

      let sweeping = false
      const runSweep = async () => {
        if (sweeping) return
        sweeping = true
        try {
          await sweepAutoActive()
        } catch (e) {
          console.error('auto-active sweep failed:', e)
        } finally {
          sweeping = false
        }
      }
      await runSweep()
      setInterval(runSweep, 60_000)

      const port = Number(process.argv[3] ?? loadConfig().port)
      serve({ fetch: buildApp().fetch, port })
      console.log(`PlanKeep serving on http://localhost:${port} (vault: ${loadConfig().vaultPath})`)
      break
    }
    case 'hook': {
      const { runHook } = await import('./hook.js')
      await runHook()
      break
    }
    case 'scan': {
      const { scan } = await import('./scanner.js')
      const result = scan()
      console.log(`Scan complete: ${result.added} new candidate(s) from ${result.examined} file(s) examined.`)
      break
    }
    case 'mcp': {
      const { runMcp } = await import('./mcp.js')
      await runMcp()
      break
    }
    case 'init': {
      const { ensureVaultRepo } = await import('./gitops.js')
      await ensureVaultRepo()
      console.log(`Vault ready at ${loadConfig().vaultPath}`)
      break
    }
    default:
      console.error(`Unknown command: ${command}. Usage: plankeep <serve|hook|scan|mcp|init>`)
      process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
