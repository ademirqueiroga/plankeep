// markdown-it-task-lists ships no types; the plugin takes (md, options) like every markdown-it plugin.
declare module 'markdown-it-task-lists' {
  import type MarkdownIt from 'markdown-it'
  const taskLists: MarkdownIt.PluginWithOptions<{ enabled?: boolean; label?: boolean; labelAfter?: boolean }>
  export default taskLists
}
