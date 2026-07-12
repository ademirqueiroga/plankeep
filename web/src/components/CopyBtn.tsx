import { useState } from 'react'

/** LLM-friendly nicety: one-click copy of paths/snippets for pasting into prompts. */
export function CopyBtn({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="copy-btn"
      title={`Copy: ${value}`}
      onClick={(e) => {
        e.stopPropagation()
        navigator.clipboard.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
    >
      {copied ? '✓ copied' : (label ?? '⧉')}
    </button>
  )
}
