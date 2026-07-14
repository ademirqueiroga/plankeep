import type { View } from './App'

export function viewToHash(view: View): string {
  switch (view.kind) {
    case 'doc':
      return `#/doc/${view.path.split('/').map(encodeURIComponent).join('/')}`
    case 'memory':
      return `#/memory/${encodeURIComponent(view.slug)}/${encodeURIComponent(view.file)}`
    case 'queue':
      return '#/queue'
    default:
      return `#/${view.kind}`
  }
}

export function hashToView(hash: string): View | null {
  const raw = hash.replace(/^#\/?/, '')
  if (!raw) return null
  const segments = raw.split('/').filter(Boolean)
  const [kind, ...rest] = segments

  if (kind === 'doc' && rest.length > 0) {
    return { kind: 'doc', path: rest.map(decodeURIComponent).join('/') }
  }
  if (kind === 'memory' && rest.length >= 2) {
    const [slug, file] = rest.map(decodeURIComponent)
    return { kind: 'memory', slug, file, displayName: slug, title: file }
  }
  if (kind === 'queue' || kind === 'inbox' || kind === 'search' || kind === 'settings' || kind === 'activity' || kind === 'memories') {
    return { kind }
  }
  return null
}
