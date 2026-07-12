import { useEffect, useState } from 'react'
import { api, type Config, type GitState } from '../api'
import { CopyBtn } from './CopyBtn'

export function SettingsView({ refresh }: { refresh: () => Promise<void> }) {
  const [config, setConfig] = useState<Config | null>(null)
  const [vaultPath, setVaultPath] = useState('')
  const [git, setGit] = useState<GitState | null>(null)
  const [log, setLog] = useState<Array<{ hash: string; date: string; message: string }>>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [repoName, setRepoName] = useState('plans-vault')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const meta = await api.meta()
    setConfig(meta.config)
    setVaultPath(meta.vaultPath)
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
    </div>
  )
}
