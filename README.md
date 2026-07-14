# PlanKeep

Centralized, git-backed home for the markdown artifacts AI sessions produce — plans, findings, exploration and research notes — with a web UI, an "up next" queue, a Claude Code hook, and an MCP server so LLMs can read/write the vault directly.

## How it works

- The **vault** (your data) is a plain git repo of folders + markdown files (default `~/plans-vault`). Per-doc metadata (type, status, tags, source project) is YAML front-matter under the `plankeep:` key; the up-next order is `.plankeep/queue.yaml`. Everything is readable without the app — `cat` works.
- **Every mutation auto-commits** to the vault repo. Git history is the backup/undo mechanism; optionally push to a private GitHub remote.
- The **inbox** collects candidate `.md` files found by a Claude Code hook (fires whenever Claude writes a markdown file anywhere) and by a scanner that sweeps your workspace for orphan plan files. You triage: import (copy or move) into a per-project folder, or dismiss.
- **AI actions** (improve readability, add checkboxes, refresh-plan-vs-repo) shell out to `claude -p`, using your existing Claude Code auth — no API keys.
- Machine-local state lives in `~/.plankeep/` (`config.json`, `inbox.json`) — never synced, so two machines can share one vault remote. Sync conflicts are resolved with normal git tooling, then re-synced; the app deliberately does no conflict resolution of its own.

## UI

Left sidebar (resizable): Inbox, a scrollable **Up Next** preview, and the vault file tree — multi-select (⌘-click, ⇧-click), drag to move, drop `.md` files anywhere in the tree area to import, right-click for file actions (rename, copy path, reveal in Finder, safe delete). Footer shows live git sync state next to Settings. Top bar: breadcrumb + search (`⌘K`). Document view renders markdown with clickable checkboxes and a right-hand properties panel (type/status/tags, actions, AI, paths).

Dropped files are matched by name against the scan roots to recover their real path, so they're filed under their source project's folder and copy/move semantics work even though browsers hide file paths.

## Requirements

- **Node.js 20+** and npm
- **git**
- Optional: **gh** (GitHub CLI, authenticated) — for the one-click "Create private GitHub repo" button
- Optional: **claude** (Claude Code CLI) — for AI actions and the hook/MCP integrations

## Install

```bash
git clone git@github.com:ademirqueiroga/plankeep.git
cd plankeep
npm install
npm run build          # builds web (Vite) then server (tsc)
```

## Run

```bash
node server/dist/cli.js serve        # http://localhost:5175
```

First run creates the vault (`~/plans-vault`) as a git repo and `~/.plankeep/config.json` with defaults. Change the port with `node server/dist/cli.js serve 5180` or the `port` config field.

### CLI

```bash
node server/dist/cli.js serve   # UI + API
node server/dist/cli.js scan    # sweep scan roots for orphan .md files -> inbox
node server/dist/cli.js hook    # Claude Code PostToolUse handler (reads event JSON on stdin)
node server/dist/cli.js mcp     # MCP server over stdio
node server/dist/cli.js init    # create/repair the vault
```

## Setup: Claude Code hook (auto-detect new plan files)

Add to `~/.claude/settings.json` (global — watches every project). Use absolute paths; hooks don't always inherit your interactive PATH:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "/absolute/path/to/node /absolute/path/to/plankeep/server/dist/cli.js hook 2>/dev/null || true",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

Every markdown file Claude writes lands in the inbox, except infra files (README/CLAUDE/AGENTS/CHANGELOG/LICENSE/…) and anything under `node_modules`/`.git`/`build`/`dist`. Writes to markdown files already in the vault are instead recorded as activity (`~/.plankeep/activity.json`) so the UI can warn before moving a doc a Claude session may still be using. The hook always exits 0 and prints nothing, so it can never disturb a session. Already-running sessions won't pick up a settings change until restarted.

## Setup: MCP server (let LLMs use the vault)

```bash
claude mcp add --scope user plankeep -- /absolute/path/to/node /absolute/path/to/plankeep/server/dist/cli.js mcp
```

Tools: `save_document` (LLMs should file plans here instead of repo roots), `list_documents`, `get_document`, `import_file`, `search_documents`, `set_metadata`, `report_plan_state`, `get_up_next_queue`, `add_to_up_next`, `list_inbox`, `list_vaults`. Tip: add a memory/CLAUDE.md note telling Claude to save plans via `save_document` with `folder` = project name.

## Skill: plan execution

`skills/plan-execution/SKILL.md` teaches an agent the protocol for working a plan stored in the vault: read it fully first, call `report_plan_state` with `working` on start, `waiting` (with a one-line note) whenever it stops before completion, and `done` when finished — so the vault UI always reflects whether a plan is actively being worked or stalled waiting on the human.

Install (symlink so repo updates propagate):

```bash
mkdir -p ~/.claude/skills
ln -s /absolute/path/to/plankeep/skills/plan-execution ~/.claude/skills/plankeep-plan-execution
```

## Setup: vault backup on GitHub

Either click **Settings → Create private GitHub repo** in the UI (requires `gh`), or manually:

```bash
cd ~/plans-vault
gh repo create plans-vault --private
git remote add origin git@github.com:<you>/plans-vault.git
git push -u origin main
```

Then enable **auto-push** in Settings. Sync = commit → `pull --rebase` → push.

## Configuration (`~/.plankeep/config.json`)

| Field | Default | Meaning |
|-------|---------|---------|
| `vaultPath` | `~/plans-vault` | Vault location |
| `importMode` | `copy` | `copy` keeps the source file; `move` deletes it after import (overridable per import) |
| `git.autoCommit` | `true` | Commit every mutation (the backup mechanism — leave on) |
| `git.autoPush` | `false` | Debounced push after commits (needs remote) |
| `git.remote` | `""` | Origin URL, also settable in the UI |
| `scanRoots` | `~/.claude/plans`, `~/workspace` | Dirs swept by scanner/drop-resolution: the root's own `*.md` plus each immediate subdirectory's root-level `*.md` |
| `port` | `5175` | HTTP port |

All editable in the Settings view.

## Development

```bash
npm run dev -w server    # tsx, serves API on :5175
npm run dev -w web       # Vite dev server with /api proxy to :5175
```

Layout: `server/` (TypeScript — vault core, Hono API, MCP, CLI, hook) and `web/` (React + Vite SPA, served from `web/dist` by the server in production). Visual language: Claude-report palette (cream/ink/terracotta, serif display) with Linear/Notion interaction density.

## Troubleshooting

- **Hook not firing**: `echo '{"tool_name":"Write","tool_input":{"file_path":"/tmp/x-plan.md"}}' | node server/dist/cli.js hook` then check `~/.plankeep/inbox.json` (or, for a vault file, `~/.plankeep/activity.json`); validate settings with `jq . ~/.claude/settings.json`; open `/hooks` in Claude Code or restart it to reload config.
- **MCP not listed**: `claude mcp list` — re-add with absolute paths; applies to new sessions only.
- **AI action fails with "output did not look like the updated document"**: the model returned prose instead of the doc; the original file is untouched — retry.
- **Sync error / conflict**: fix inside `~/plans-vault` with git directly, then Sync again.
