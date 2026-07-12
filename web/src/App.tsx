import { useCallback, useEffect, useState } from 'react'
import { api, type Config, type GitState, type TreeNode } from './api'
import { Sidebar } from './components/Sidebar'
import { DocView } from './components/DocView'
import { QueueView } from './components/QueueView'
import { InboxView } from './components/InboxView'
import { SettingsView } from './components/SettingsView'
import { SearchView } from './components/SearchView'

export type View =
  | { kind: 'doc'; path: string }
  | { kind: 'queue' }
  | { kind: 'inbox' }
  | { kind: 'search' }
  | { kind: 'settings' }
  | { kind: 'empty' }

export default function App() {
  const [view, setView] = useState<View>({ kind: 'queue' })
  const [tree, setTree] = useState<TreeNode | null>(null)
  const [inboxCount, setInboxCount] = useState(0)
  const [git, setGit] = useState<GitState | null>(null)
  const [config, setConfig] = useState<Config | null>(null)

  const refresh = useCallback(async () => {
    const [t, inbox, g, meta] = await Promise.all([api.tree(), api.inbox(), api.gitStatus(), api.meta()])
    setTree(t)
    setInboxCount(inbox.length)
    setGit(g)
    setConfig(meta.config)
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 30_000)
    return () => clearInterval(timer)
  }, [refresh])

  const openDoc = useCallback((path: string) => setView({ kind: 'doc', path }), [])

  return (
    <div className="app">
      <Sidebar
        tree={tree}
        view={view}
        inboxCount={inboxCount}
        git={git}
        setView={setView}
        openDoc={openDoc}
        refresh={refresh}
      />
      <main className="main">
        {view.kind === 'doc' && (
          <DocView key={view.path} path={view.path} config={config} refresh={refresh} onDeleted={() => setView({ kind: 'queue' })} onMoved={openDoc} />
        )}
        {view.kind === 'queue' && <QueueView openDoc={openDoc} refresh={refresh} />}
        {view.kind === 'inbox' && <InboxView config={config} openDoc={openDoc} refresh={refresh} />}
        {view.kind === 'search' && <SearchView openDoc={openDoc} />}
        {view.kind === 'settings' && <SettingsView refresh={refresh} />}
        {view.kind === 'empty' && <div className="empty-state">Select a document, or check your Up Next queue.</div>}
      </main>
    </div>
  )
}
