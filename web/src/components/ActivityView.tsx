import { useEffect, useState } from 'react'
import { api, type AiJob } from '../api'

export const ACTION_LABELS: Record<string, string> = {
  improve: 'Improve readability',
  checkboxify: 'Add checkboxes',
  refresh: 'Refresh vs repo',
}

export function ago(iso: string): string {
  const sec = (Date.now() - new Date(iso).getTime()) / 1000
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`
  return `${Math.round(sec / 86400)}d ago`
}

function formatDuration(ms: number): string {
  const sec = ms / 1000
  if (sec < 60) return `${Math.round(sec)}s`
  return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`
}

export function ActivityView({ openDoc }: { openDoc: (path: string) => void }) {
  const [jobs, setJobs] = useState<AiJob[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    const load = () => api.aiJobs().then(setJobs)
    load()
    const timer = setInterval(load, 3000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="view">
      <h1>Activity</h1>
      <p className="hint">AI runs triggered from a document's AI panel — each is <code>claude -p</code> running in the background.</p>
      {jobs.length === 0 && <div className="empty-state">No AI runs yet. Trigger one from a document's AI panel.</div>}
      <ul className="activity-list">
        {jobs.map((job) => (
          <li key={job.id} className="activity-row">
            <div
              className="activity-main"
              onClick={() => job.status === 'error' && setExpanded(expanded === job.id ? null : job.id)}
            >
              <span className={`activity-status ${job.status}`}>
                <span className="activity-dot" />
                {job.status === 'running' ? 'Running' : job.status === 'done' ? 'Done' : 'Error'}
              </span>
              <span className="activity-action">{ACTION_LABELS[job.action] ?? job.action}</span>
              <button
                className="activity-path"
                onClick={(e) => {
                  e.stopPropagation()
                  openDoc(job.path)
                }}
              >
                {job.path}
              </button>
              <span className="activity-time">{ago(job.startedAt)}</span>
              {job.durationMs != null && <span className="activity-duration">{formatDuration(job.durationMs)}</span>}
            </div>
            {job.status === 'error' && expanded === job.id && (
              <div className="activity-error-detail">
                <div>{job.error}</div>
                {job.stderrTail && <pre>{job.stderrTail}</pre>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
