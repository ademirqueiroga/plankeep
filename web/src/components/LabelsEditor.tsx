import { useEffect, useState } from 'react'
import { api } from '../api'

interface LabelsEditorProps {
  value: string[]
  onChange: (tags: string[]) => void
  inputRef: React.RefObject<HTMLInputElement | null>
}

export function LabelsEditor({ value, onChange, inputRef }: LabelsEditorProps) {
  const [text, setText] = useState('')
  const [known, setKnown] = useState<Array<{ label: string; count: number }>>([])
  const [highlight, setHighlight] = useState(0)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    api.labels().then(setKnown)
  }, [])

  const filtered = text.trim()
    ? known.filter((k) => k.label.toLowerCase().includes(text.trim().toLowerCase()) && !value.includes(k.label)).slice(0, 8)
    : []

  const commit = (label: string) => {
    const clean = label.trim()
    if (clean && !value.includes(clean)) onChange([...value, clean])
    setText('')
    setHighlight(0)
  }

  const removeChip = (label: string) => onChange(value.filter((t) => t !== label))

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commit(filtered[highlight]?.label ?? text)
    } else if (e.key === 'Backspace' && text === '' && value.length > 0) {
      e.preventDefault()
      removeChip(value[value.length - 1])
    } else if (e.key === 'ArrowDown' && filtered.length > 0) {
      e.preventDefault()
      setHighlight((h) => (h + 1) % filtered.length)
    } else if (e.key === 'ArrowUp' && filtered.length > 0) {
      e.preventDefault()
      setHighlight((h) => (h - 1 + filtered.length) % filtered.length)
    } else if (e.key === 'Escape' && text) {
      e.preventDefault()
      setText('')
    }
  }

  return (
    <div className="labels-editor">
      <div className="labels-chips">
        {value.map((tag) => (
          <span key={tag} className="label-chip">
            {tag}
            <button type="button" onClick={() => removeChip(tag)}>×</button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="labels-input"
          value={text}
          placeholder={value.length === 0 ? 'Add a label…' : ''}
          onChange={(e) => {
            setText(e.target.value)
            setHighlight(0)
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </div>
      {focused && filtered.length > 0 && (
        <div className="labels-suggestions">
          {filtered.map((k, i) => (
            <button
              key={k.label}
              type="button"
              className={`menu-item${i === highlight ? ' picker-highlight' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => commit(k.label)}
            >
              <span>{k.label}</span>
              <span className="menu-hint">{k.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
