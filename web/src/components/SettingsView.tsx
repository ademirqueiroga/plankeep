import { useEffect, useState } from 'react'
import { api, type Config, type GitState, type McpInfo } from '../api'
import { CopyBtn } from './CopyBtn'
import { ShortcutsModal } from './ShortcutsModal'

const MCP_TOOLS = [
  'list_documents', 'get_document', 'save_document', 'import_file',
  'search_documents', 'set_metadata', 'get_up_next_queue', 'add_to_up_next', 'list_inbox',
]

export function SettingsView({ refresh }: { refresh: () => Promise<void> }) {
  const [config, setConfig] = useState<Config | null>(null)
  const [vaultPath, setVaultPath] = useState('')
  const [mcp, setMcp] = useState<McpInfo | null>(null)
  const [git, setGit] = useState<GitState | null>(null)
  const [log, setLog] = useState<Array<{ hash: string; date: string; message: string }>>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [repoName, setRepoName] = useState('plans-vault')
  const [busy, setBusy] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [mcpCollapsed, setMcpCollapsed] = useState(() => localStorage.getItem('pk-mcp-setup-collapsed') === '1')

  useEffect(() => {
    localStorage.setItem('pk-mcp-setup-collapsed', mcpCollapsed ? '1' : '0')
  }, [mcpCollapsed])

  const load = async () => {
    const meta = await api.meta()
    setConfig(meta.config)
    setVaultPath(meta.vaultPath)
    setMcp(meta.mcp)
    setGit(await api.gitStatus())
    setLog(await api.gitLog())
  }
  useEffect(() => {
    load()
  }, [])

  if (!config) return <div className="empty-state">Loading…</div>

  const save = async (patch: Partial<Config>) => {
    const next = { ...config, ...patch }
    setConfig(next)
    await api.saveSettings(next)
    setMsg('Settings saved.')
    await refresh()
  }

  const sync = async () => {
    setBusy(true)
    setMsg('Syncing…')
    const state = await api.gitSync()
    setGit(state)
    setMsg(
      state.conflicted
        ? '⚠️ Conflict — resolve in your git tool of choice inside the vault, then hit Sync again.'
        : state.lastError
          ? `⚠️ ${state.lastError}`
          : '✅ Synced.',
    )
    setBusy(false)
    await load()
    await refresh()
  }

  const createRepo = async () => {
    setBusy(true)
    setMsg('Creating private GitHub repo and pushing…')
    try {
      const r = await api.createRemote(repoName)
      setMsg(`✅ Created ${r.url} and pushed the vault.`)
    } catch (e) {
      setMsg(`⚠️ ${(e as Error).message}`)
    }
    setBusy(false)
    await load()
  }

  return (
    <div className="view">
      <h1>Settings</h1>
      {msg && <div className="banner">{msg} <button className="icon-btn" onClick={() => setMsg(null)}>✕</button></div>}

      <section>
        <h2>Vault</h2>
        <div className="field">
          <label>Location</label>
          <span className="path-chip">{vaultPath}<CopyBtn value={vaultPath} /></span>
        </div>
        <div className="field">
          <label>Default import mode</label>
          <select value={config.importMode} onChange={(e) => save({ importMode: e.target.value as Config['importMode'] })}>
            <option value="copy">copy — original file stays in the source repo</option>
            <option value="move">move — original file is deleted after import</option>
          </select>
        </div>
      </section>

      <section>
        <button className="collapsible-toggle" onClick={() => setMcpCollapsed((c) => !c)}>
          <span className={`chevron${!mcpCollapsed ? ' open' : ''}`}>›</span>
          <h2>Connect an LLM (MCP)</h2>
        </button>
        {!mcpCollapsed && <McpSetup mcp={mcp} />}
      </section>

      <section>
        <h2>Git backup & sync</h2>
        {git && (
          <p className="hint">
            branch <b>{git.branch || '—'}</b> · {git.dirty} uncommitted · ↑{git.ahead} ↓{git.behind}
            {git.conflicted && ' · ⚠️ CONFLICTED'}
            {git.remote ? <> · remote <b>{git.remote}</b></> : ' · no remote configured'}
          </p>
        )}
        <div className="field">
          <label>Remote URL</label>
          <input
            defaultValue={config.git.remote}
            placeholder="git@github.com:you/plans-vault.git"
            onBlur={(e) => e.target.value !== config.git.remote && save({ git: { ...config.git, remote: e.target.value } })}
          />
        </div>
        <div className="field">
          <label>
            <input type="checkbox" checked={config.git.autoCommit} onChange={(e) => save({ git: { ...config.git, autoCommit: e.target.checked } })} />
            Auto-commit every change (recommended — this is the backup/history mechanism)
          </label>
        </div>
        <div className="field">
          <label>
            <input type="checkbox" checked={config.git.autoPush} onChange={(e) => save({ git: { ...config.git, autoPush: e.target.checked } })} />
            Auto-push after commits (requires remote)
          </label>
        </div>
        <div className="field row">
          <button className="primary" disabled={busy} onClick={sync}>Sync now (commit → pull --rebase → push)</button>
        </div>
        {!git?.remote && (
          <div className="field row">
            <input value={repoName} onChange={(e) => setRepoName(e.target.value)} title="Repository name" />
            <button disabled={busy} onClick={createRepo}>Create private GitHub repo (via gh)</button>
          </div>
        )}
        <p className="hint">
          Conflict resolution is intentionally left to git itself: fix conflicts in the vault with your normal git tooling, then Sync again.
        </p>
      </section>

      <section>
        <h2>Scanner roots</h2>
        <p className="hint">Directories swept for orphan plan/findings markdown (the root itself plus each immediate subdirectory's root-level *.md). One per line.</p>
        <textarea
          className="roots"
          defaultValue={config.scanRoots.join('\n')}
          onBlur={(e) => {
            const roots = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean)
            if (roots.join() !== config.scanRoots.join()) save({ scanRoots: roots })
          }}
        />
      </section>

      <section>
        <h2>Excluded paths</h2>
        <p className="hint">
          Markdown files under these paths never enter the inbox. Supports * (one path segment) and ** (any depth), e.g. ~/.claude/plans/*/*/progress
        </p>
        <textarea
          className="roots"
          defaultValue={config.excludePaths.join('\n')}
          onBlur={(e) => {
            const paths = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean)
            if (paths.join() !== config.excludePaths.join()) save({ excludePaths: paths })
          }}
        />
      </section>

      <section>
        <h2>Vault history (latest commits)</h2>
        <div className="git-log">
          {log.map((l) => (
            <div key={l.hash} className="git-log-row">
              <code>{l.hash}</code>
              <span className="git-log-date">{new Date(l.date).toLocaleString()}</span>
              <span>{l.message}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>Keyboard shortcuts</h2>
        <button onClick={() => setShortcutsOpen(true)}>View keyboard shortcuts…</button>
      </section>

      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  )
}

function McpSetup({ mcp }: { mcp: McpInfo | null }) {
  const node = mcp?.node ?? '/absolute/path/to/node'
  const cliPath = mcp?.cliPath ?? '/absolute/path/to/plankeep/server/dist/cli.js'
  const claudeCodeCmd = `claude mcp add --scope user plankeep -- ${node} ${cliPath} mcp`
  const desktopConfig = JSON.stringify(
    { mcpServers: { plankeep: { command: node, args: [cliPath, 'mcp'] } } },
    null,
    2,
  )

  return (
    <div className="collapsible-body">
      <p className="hint">
        PlanKeep isn't discovered automatically — an LLM needs its MCP server registered once so it can list,
        search, and file documents straight into this vault instead of scattering plans in repo roots.
      </p>

      {mcp && !mcp.cliPath && (
        <div className="banner error">
          <span className="banner-body">
            Build output not found — run <code>npm run build -w server</code> once, then reopen Settings for a ready-to-copy command.
          </span>
        </div>
      )}

      <h3>Claude Code</h3>
      <p className="hint">Run once in a terminal (applies to new sessions only):</p>
      <div className="mcp-cmd">
        <code>{claudeCodeCmd}</code>
        <CopyBtn value={claudeCodeCmd} />
      </div>

      <h3>Claude Desktop</h3>
      <p className="hint">Add this under <code>mcpServers</code> in your <code>claude_desktop_config.json</code>:</p>
      <div className="mcp-cmd">
        <pre>{desktopConfig}</pre>
        <CopyBtn value={desktopConfig} />
      </div>

      <h3>Tools exposed</h3>
      <p className="hint">
        {MCP_TOOLS.map((t, i) => (
          <span key={t}>
            {i > 0 && ', '}
            <code>{t}</code>
          </span>
        ))}
      </p>

      <p className="hint">
        Tip: add a note in the project's CLAUDE.md telling Claude to file plans here via <code>save_document</code> (with{' '}
        <code>folder</code> set to the project name) instead of leaving them in the repo root.
      </p>
    </div>
  )
}
