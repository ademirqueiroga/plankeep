import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'
import { readDoc, type DocMeta } from './vault.js'

const execFileAsync = promisify(execFile)

export const NO_CHROME_MESSAGE =
  'No Chromium-based browser found. Install Google Chrome, or set PLANKEEP_CHROME to a browser binary.'

const md = new MarkdownIt({ html: false, linkify: true, typographer: false }).use(taskLists, { enabled: false })

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
]
const LINUX_BINARIES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']

let chromeCache: { value: string | null } | null = null

/** Locate a Chromium-family binary: PLANKEEP_CHROME, then known app paths, then PATH. Cached per process. */
export function findChrome(): string | null {
  if (chromeCache) return chromeCache.value
  let found: string | null = null
  const override = process.env.PLANKEEP_CHROME
  if (override) {
    found = fs.existsSync(override) ? override : null
  } else {
    found = CHROME_CANDIDATES.find((p) => fs.existsSync(p)) ?? null
    if (!found) {
      for (const bin of LINUX_BINARIES) {
        const hit = whichSync(bin)
        if (hit) {
          found = hit
          break
        }
      }
    }
  }
  chromeCache = { value: found }
  return found
}

function whichSync(bin: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue
    const candidate = path.join(dir, bin)
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      return candidate
    } catch {
      // not here — keep looking
    }
  }
  return null
}

/** Doc title → a filename that is safe on every platform. */
export function safeFilename(title: string, rel: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
    .replace(/[.\s-]+$/, '')
  return `${cleaned || path.basename(rel, '.md')}.pdf`
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function metaLine(meta: DocMeta): string {
  const parts: string[] = [meta.type, meta.status]
  if (meta.source?.project) parts.push(meta.source.project)
  if (meta.updated) {
    const d = new Date(meta.updated)
    if (!Number.isNaN(d.getTime())) {
      parts.push(`updated ${d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}`)
    }
  }
  return parts.join(' · ')
}

const CHECK_SVG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.6 6.3 4.9 8.6 9.4 3.7' fill='none' stroke='%23fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")"

/** Print stylesheet — the app's report look (ink on paper, serif headings, terracotta accents) in print units. */
const CSS = `
@page { margin: 20mm 17mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  margin: 0;
  background: #fff;
  color: #0b0b0b;
  font-family: -apple-system, BlinkMacSystemFont, system-ui, 'Segoe UI', Roboto, sans-serif;
  font-size: 11pt;
  line-height: 1.65;
}
.doc-head { margin-bottom: 26px; }
.doc-head h1 {
  font-family: ui-serif, Georgia, 'Times New Roman', serif;
  font-size: 22pt;
  font-weight: 600;
  line-height: 1.25;
  margin: 0 0 7px;
}
.doc-head .meta { color: #52514e; font-size: 9pt; letter-spacing: 0.2px; }
.doc-head .rule { border-top: 1px solid rgba(11, 11, 11, 0.12); margin-top: 16px; }
h1, h2, h3, h4, h5, h6 {
  font-family: ui-serif, Georgia, 'Times New Roman', serif;
  font-weight: 600;
  line-height: 1.3;
  margin: 1.5em 0 0.5em;
  break-after: avoid;
  page-break-after: avoid;
}
h1 { font-size: 17pt; }
h2 { font-size: 14pt; border-bottom: 1px solid rgba(11, 11, 11, 0.12); padding-bottom: 4px; }
h3 { font-size: 12pt; }
h4, h5, h6 { font-size: 11pt; }
p { margin: 0.7em 0; }
a { color: #c6613f; text-decoration-color: rgba(198, 97, 63, 0.4); }
strong { font-weight: 600; }
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 9.5pt;
  background: #f6f5f1;
  border-radius: 3px;
  padding: 1px 4px;
}
pre {
  background: #f6f5f1;
  border: 1px solid rgba(11, 11, 11, 0.12);
  border-radius: 6px;
  padding: 11px 13px;
  overflow: hidden;
  white-space: pre-wrap;
  word-wrap: break-word;
  break-inside: avoid;
  page-break-inside: avoid;
}
pre code { background: none; padding: 0; font-size: 9pt; line-height: 1.5; }
table {
  border-collapse: collapse;
  width: 100%;
  margin: 1em 0;
  font-size: 10pt;
  break-inside: avoid;
  page-break-inside: avoid;
}
th { font-weight: 600; text-align: left; border-bottom: 1.5px solid rgba(11, 11, 11, 0.28); padding: 6px 12px 6px 0; }
td { border-bottom: 1px solid rgba(11, 11, 11, 0.12); padding: 6px 12px 6px 0; vertical-align: top; }
blockquote {
  border-left: 3px solid #c6613f;
  margin: 1em 0;
  padding: 2px 0 2px 16px;
  color: #52514e;
  break-inside: avoid;
  page-break-inside: avoid;
}
hr { border: none; border-top: 1px solid rgba(11, 11, 11, 0.12); margin: 2em 0; }
ul, ol { padding-left: 1.5em; margin: 0.7em 0; }
li { margin: 0.25em 0; }
li.task-list-item { list-style: none; margin-left: -1.35em; }
img { max-width: 100%; }
input[type='checkbox'] {
  appearance: none;
  -webkit-appearance: none;
  width: 11px;
  height: 11px;
  margin: 0 7px 0 0;
  border: 1px solid rgba(11, 11, 11, 0.4);
  border-radius: 3px;
  background: #fff;
  vertical-align: -1px;
}
input[type='checkbox']:checked {
  background: #c6613f ${CHECK_SVG} center / 9px 9px no-repeat;
  border-color: #c6613f;
}
`

const PRINT_SCRIPT = '<script>window.onload = () => window.print()</script>'

/** The title block already prints the title — drop the body's leading `# Title` so it isn't set twice. */
function dropLeadingTitle(body: string, title: string): string {
  return body.replace(/^\s*#\s+(.+?)[ \t]*\r?\n/, (match, heading: string) => (heading.trim() === title ? '' : match))
}

/** Render a vault doc as a standalone, fully self-contained HTML document (no external assets). */
export function renderHtml(rel: string, opts: { print?: boolean; root?: string } = {}): { html: string; title: string } {
  const { body, meta, title } = readDoc(rel, opts.root)
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
<header class="doc-head">
<h1>${escapeHtml(title)}</h1>
<div class="meta">${escapeHtml(metaLine(meta))}</div>
<div class="rule"></div>
</header>
${md.render(dropLeadingTitle(body, title))}
${opts.print ? PRINT_SCRIPT : ''}
</body>
</html>
`
  return { html, title }
}

export interface PdfExport {
  pdfPath: string
  title: string
  filename: string
}

/** Render a doc to PDF via headless Chrome. Writes to `outPath`, or a temp file the caller owns. */
export async function exportPdf(rel: string, outPath?: string, root?: string): Promise<PdfExport> {
  const chrome = findChrome()
  if (!chrome) throw new Error(NO_CHROME_MESSAGE)

  const { html, title } = renderHtml(rel, { root })
  const filename = safeFilename(title, rel)
  const stamp = crypto.randomUUID()
  const htmlPath = path.join(os.tmpdir(), `plankeep-${stamp}.html`)
  const pdfPath = outPath ? path.resolve(outPath) : path.join(os.tmpdir(), `plankeep-${stamp}.pdf`)

  fs.writeFileSync(htmlPath, html)
  try {
    fs.mkdirSync(path.dirname(pdfPath), { recursive: true })
    await execFileAsync(
      chrome,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-pdf-header-footer',
        `--print-to-pdf=${pdfPath}`,
        `file://${encodeURI(htmlPath)}`,
      ],
      { timeout: 10_000 },
    )
    if (!fs.existsSync(pdfPath)) throw new Error('Chrome did not produce a PDF')
  } finally {
    fs.rmSync(htmlPath, { force: true })
  }
  return { pdfPath, title, filename }
}
