export type DocType = 'plan' | 'findings' | 'exploration' | 'research' | 'note'
export type DocStatus = 'draft' | 'active' | 'done' | 'archived' | 'waiting'

export interface DocMeta {
  id: string
  type: DocType
  status: DocStatus
  tags: string[]
  source?: { project?: string; path?: string; mode?: 'copy' | 'move' }
  imported?: string
  updated?: string
  agentNote?: string
  /** Id of the doc this one derives from (e.g. the plan a findings file came out of). */
  derivedFrom?: string
}

export interface ClaudeActivity {
  at: string
  sessionId?: string
  cwd?: string
}

export interface DocSummary {
  path: string
  title: string
  meta: DocMeta
  progress: { done: number; total: number }
  mtime: number
  claudeActivity?: ClaudeActivity
}

export interface TreeNode {
  name: string
  path: string
  kind: 'folder' | 'doc'
  children?: TreeNode[]
  doc?: DocSummary
}

export interface DocLink {
  path: string
  title: string
}

export interface FullDoc {
  path: string
  absPath: string
  content: string
  body: string
  meta: DocMeta
  title: string
  mtime: number
  claudeActivity?: ClaudeActivity
  /** The doc this one derives from — omitted when unset or dangling (parent deleted). */
  parent?: DocLink
  /** Docs that derive from this one. */
  derived: DocLink[]
}

export interface InboxItem {
  path: string
  project: string
  detectedAt: string
  origin: 'hook' | 'scan'
  status: string
  mtime: number
  title: string
  preview: string[]
}

export interface GitState {
  initialized: boolean
  branch: string
  dirty: number
  remote: string
  ahead: number
  behind: number
  conflicted: boolean
  lastError?: string
}

export interface AiJob {
  id: string
  action: string
  path: string
  status: 'running' | 'done' | 'error'
  startedAt: string
  finishedAt?: string
  error?: string
  durationMs?: number
  outputChars?: number
  stderrTail?: string
  cwd: string
}

export interface SearchHit {
  path: string
  title: string
  meta: DocMeta
  snippets: string[]
}

export interface MemoryFile {
  file: string
  title: string
  description: string
  mtime: number
}

export interface MemoryProject {
  slug: string
  displayName: string
  dir: string
  count: number
  latestMtime: number
  hasIndex: boolean
  files: MemoryFile[]
}

export interface MemoryDoc {
  content: string
  body: string
  frontmatter: Record<string, unknown>
  absPath: string
}

export interface VaultEntry {
  name: string
  path: string
  remote?: string
  autoPush?: boolean
}

export interface Config {
  vaults: VaultEntry[]
  activeVault: string
  importMode: 'copy' | 'move'
  git: { autoCommit: boolean }
  scanRoots: string[]
  excludePaths: string[]
  port: number
}

export interface McpInfo {
  node: string
  cliPath: string | null
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? res.statusText)
  return data as T
}

const post = <T,>(url: string, body: unknown): Promise<T> =>
  request<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const put = <T,>(url: string, body: unknown): Promise<T> =>
  request<T>(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const patch = <T,>(url: string, body: unknown): Promise<T> =>
  request<T>(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const del = <T,>(url: string): Promise<T> => request<T>(url, { method: 'DELETE' })

export interface VaultsResponse {
  vaults: VaultEntry[]
  active: string
}

export const exportPdfUrl = (path: string): string => `/api/export/pdf?path=${encodeURIComponent(path)}`
export const exportHtmlUrl = (path: string, print?: boolean): string =>
  `/api/export/html?path=${encodeURIComponent(path)}${print ? '&print=1' : ''}`

function filenameFrom(disposition: string | null): string | null {
  if (!disposition) return null
  const utf8 = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8) return decodeURIComponent(utf8[1])
  return disposition.match(/filename="([^"]+)"/i)?.[1] ?? null
}

export interface ExportResult {
  ok: boolean
  /** True when the server had no browser to print with and we opened the print-dialog fallback instead. */
  fallback?: boolean
  error?: string
}

/** Download a doc as PDF. With no server-side browser, opens the same document in a tab for the print dialog. */
export async function downloadPdf(path: string): Promise<ExportResult> {
  let res: Response
  try {
    res = await fetch(exportPdfUrl(path))
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
  if (!res.ok) {
    const error = await res
      .json()
      .then((d) => d.error as string)
      .catch(() => res.statusText)
    // 501 = no Chromium install on this machine; the user's own browser can still print the page
    if (res.status === 501) {
      window.open(exportHtmlUrl(path, true), '_blank')
      return { ok: false, fallback: true, error }
    }
    return { ok: false, error }
  }
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = filenameFrom(res.headers.get('Content-Disposition')) ?? 'document.pdf'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return { ok: true }
}

export const api = {
  meta: () => request<{ vaultPath: string; vaults: VaultEntry[]; activeVault: string; config: Config; mcp: McpInfo }>('/api/meta'),
  vaults: () => request<VaultsResponse>('/api/vaults'),
  addVault: (name: string, path: string, cloneUrl?: string) => post<VaultsResponse>('/api/vaults', { name, path, cloneUrl }),
  setActiveVault: (name: string) => put<VaultsResponse>('/api/vaults/active', { name }),
  removeVault: (name: string) => del<VaultsResponse>(`/api/vaults/${encodeURIComponent(name)}`),
  patchVault: (name: string, body: { name?: string; remote?: string; autoPush?: boolean }) =>
    patch<VaultsResponse>(`/api/vaults/${encodeURIComponent(name)}`, body),
  saveSettings: (config: Partial<Config>) => put<{ config: Config }>('/api/settings', config),
  tree: () => request<TreeNode>('/api/tree'),
  docs: () => request<DocSummary[]>('/api/docs'),
  doc: (path: string) => request<FullDoc>(`/api/doc?path=${encodeURIComponent(path)}`),
  saveDoc: (path: string, content: string) => put<DocSummary>('/api/doc', { path, content }),
  saveBody: (path: string, body: string) => put<DocSummary>('/api/doc', { path, body }),
  // derivedFrom accepts null to clear the link
  setMeta: (path: string, patch: Partial<DocMeta> & { derivedFrom?: string | null }) =>
    post<DocMeta>('/api/doc/meta', { path, ...patch }),
  move: (from: string, to: string, leaveLink?: boolean) => post('/api/docs/move', { from, to, leaveLink }),
  deleteDoc: (path: string) => post('/api/docs/delete', { path }),
  createFolder: (path: string) => post('/api/folders', { path }),
  deleteFolder: (path: string) => post('/api/folders/delete', { path }),
  renameFolder: (from: string, to: string, leaveLink?: boolean) => post('/api/folders/rename', { from, to, leaveLink }),
  folderStats: (path: string) => request<{ docs: number }>(`/api/folders/stats?path=${encodeURIComponent(path)}`),
  activity: (q: { path?: string; folder?: string; abs?: string }) => {
    const params = new URLSearchParams(q as Record<string, string>)
    return request<{ lastClaudeWrite: string | null; sessionId?: string; cwd?: string; tool?: string; path?: string }>(
      `/api/activity?${params.toString()}`,
    )
  },
  reveal: (opts: { path?: string; absPath?: string }) => post('/api/reveal', opts),
  resolveSource: (name: string) => request<Array<{ path: string; project: string }>>(`/api/resolve-source?name=${encodeURIComponent(name)}`),
  importFile: (sourcePath: string, folder?: string, mode?: string, project?: string, leaveLink?: boolean) =>
    post<{ path: string }>('/api/import', { sourcePath, folder, mode, project, leaveLink }),
  importContent: (name: string, content: string, folder?: string) =>
    post<{ path: string }>('/api/import-content', { name, content, folder }),
  search: (q: string) => request<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`),
  labels: () => request<Array<{ label: string; count: number }>>('/api/labels'),
  memories: () => request<MemoryProject[]>('/api/memories'),
  memoryDoc: (slug: string, file: string) =>
    request<MemoryDoc>(`/api/memories/doc?slug=${encodeURIComponent(slug)}&file=${encodeURIComponent(file)}`),
  queue: () => request<DocSummary[]>('/api/queue'),
  setQueue: (paths: string[]) => put<DocSummary[]>('/api/queue', { paths }),
  queueAdd: (path: string, position?: number) => post<DocSummary[]>('/api/queue/add', { path, position }),
  queueRemove: (path: string) => post<DocSummary[]>('/api/queue/remove', { path }),
  inbox: () => request<InboxItem[]>('/api/inbox'),
  dismiss: (path: string) => post('/api/inbox/dismiss', { path }),
  scan: () => post<{ added: number; examined: number }>('/api/scan', {}),
  gitStatus: () => request<GitState>('/api/git/status'),
  gitLog: () => request<Array<{ hash: string; date: string; message: string }>>('/api/git/log'),
  gitSync: () => post<GitState>('/api/git/sync', {}),
  createRemote: (name: string) => post<{ url: string }>('/api/git/create-remote', { name }),
  aiRun: (path: string, action: string) => post<AiJob>('/api/ai/run', { path, action }),
  aiJob: (id: string) => request<AiJob>(`/api/ai/jobs/${id}`),
  aiJobs: () => request<AiJob[]>('/api/ai/jobs'),
}
