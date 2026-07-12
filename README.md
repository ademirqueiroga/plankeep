# PlanKeep

Centralized, git-backed home for the markdown artifacts AI sessions produce — plans, findings, exploration and research notes — with a web UI, an "up next" queue, a Claude Code hook, and an MCP server so LLMs can read/write the vault directly.

## Layout

- `server/` — TypeScript backend: vault core, Hono HTTP API, MCP server (stdio), CLI, Claude Code hook handler.
- `web/` — React + Vite SPA served by the server at `http://localhost:5175`.

The **vault** (the data) lives separately at `~/plans-vault` — a plain git repo of folders + markdown files. Per-doc metadata is YAML front-matter under the `plankeep:` key; the queue is `.plankeep/queue.yaml`; nothing else. Every mutation auto-commits, so git history is the backup/undo mechanism. Machine-local state (config, inbox) lives in `~/.plankeep/`.

## Commands

```bash
npm run build                      # build web + server
node server/dist/cli.js serve      # start UI+API on :5175
node server/dist/cli.js scan       # sweep scan roots for orphan .md files -> inbox
node server/dist/cli.js hook       # Claude Code PostToolUse handler (reads stdin JSON)
node server/dist/cli.js mcp        # MCP server over stdio
node server/dist/cli.js init       # create/repair the vault
```

## Integrations (already installed)

- **Hook**: global `PostToolUse` on `Write` in `~/.claude/settings.json` — every markdown file Claude writes anywhere lands in the PlanKeep inbox (excluded: README/CLAUDE/AGENTS/CHANGELOG/etc., files inside the vault, node_modules/.git/build paths).
- **MCP**: registered user-scope as `plankeep` (`claude mcp list`). Key tools: `save_document` (LLMs should file plans here instead of repo roots), `list_documents`, `search_documents`, `get_up_next_queue`, `import_file`.
- **AI actions** (UI buttons): improve readability / add checkboxes / refresh-vs-repo. Implemented by shelling out to `claude -p`; `refresh` runs with cwd inside the doc's source repo with read-only tools.

## Design decisions

- Conflict resolution is out of scope by design: sync is commit → `pull --rebase` → push; on conflict the UI shows the state and the user resolves with normal git tooling, then re-syncs.
- Vault files are self-contained: any tool (or `cat`) can read them; deleting the app loses nothing.
- Import mode (copy vs move) is a setting, overridable per import.
