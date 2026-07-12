#!/usr/bin/env node
import { serve } from '@hono/node-server'
import { loadConfig } from './config.js'

const command = process.argv[2] ?? 'serve'

async function main(): Promise<void> {
  switch (command) {
    case 'serve': {
      const { buildApp } = await import('./api.js')
      const { ensureVaultRepo } = await import('./gitops.js')
      await ensureVaultRepo()
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
