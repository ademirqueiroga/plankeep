import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type DocSummary } from '../api'
import { dialog } from './Dialog'
import { activityWarning } from '../moveGuard'
import { ago } from './ActivityView'
import { TYPE_ICONS } from './Sidebar'

const ROOT_LABEL = 'Vault root'

interface ArchivedViewProps {
  openDoc: (p: string) => void
  refresh: () => Promise<void>
}

export function ArchivedView({ openDoc, refresh }: ArchivedViewProps) {
  const [docs, setDocs] = useState<DocSummary[]>([])

  const load = useCallback(async () => {
    const all = await api.docs()
    setDocs(all.filter((d) => d.meta.status === 'archived'))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const groups = useMemo(() => {
    const byFolder = new Map<string, DocSummary[]>()
    for (const d of docs) {
      const folder = d.path.includes('/') ? d.path.slice(0, d.path.lastIndexOf('/')) : ROOT_LABEL
      const list = byFolder.get(folder)
      if (list) list.push(d)
      else byFolder.set(folder, [d])
    }
    return [...byFolder.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([folder, items]) => ({ folder, items: items.sort((a, b) => b.mtime - a.mtime) }))
  }, [docs])

  const restore = async (doc: DocSummary) => {
    // restoring shouldn't resurrect a stale active/waiting state — derive it from the checkboxes instead
    const status = doc.progress.total > 0 && doc.progress.done === doc.progress.total ? 'done' : 'draft'
    await api.setMeta(doc.path, { status })
    await load()
    await refresh()
  }

  const remove = async (doc: DocSummary) => {
    const ok = await dialog.confirm({
      title: 'Delete document?',
      body: `${doc.path} — history stays in vault git.`,
      warning: await activityWarning({ path: doc.path }),
      danger: true,
      confirmLabel: 'Delete',
    })
    if (!ok) return
    try {
      await api.deleteDoc(doc.path)
      await load()
      await refresh()
    } catch (e) {
      window.alert((e as Error).message)
    }
  }

  return (
    <div className="view">
      <h1>Archived</h1>
      <p className="hint">
        Documents you archived. They stay out of the vault tree and the Up Next queue, but search still finds them — restore one to
        bring it back.
      </p>
      {docs.length === 0 && <div className="empty-state">Nothing archived. Archive a document from its context menu or the doc panel.</div>}
      {groups.map((group) => (
        <div key={group.folder} className="archived-group">
          <div className="archived-folder">{group.folder}</div>
          {group.items.map((doc) => (
            <div key={doc.path} className="archived-row">
              <div className="archived-body" onClick={() => openDoc(doc.path)}>
                <div className="archived-title-line">
                  <span className="doc-glyph">{TYPE_ICONS[doc.meta.type] ?? '≡'}</span>
                  <span className="archived-title">{doc.title}</span>
                  <span className="tag">{doc.meta.type}</span>
                </div>
                <div className="archived-sub" title={new Date(doc.mtime).toLocaleString()}>
                  archived {ago(new Date(doc.mtime).toISOString())}
                  {doc.progress.total > 0 && ` · ${doc.progress.done}/${doc.progress.total} done`}
                </div>
              </div>
              <div className="archived-actions">
                <button onClick={() => restore(doc)}>Restore</button>
                <button className="danger" onClick={() => remove(doc)}>Delete…</button>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
