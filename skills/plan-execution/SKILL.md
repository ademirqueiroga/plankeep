---
name: plankeep-plan-execution
description: Use when implementing a plan document stored in the PlanKeep vault (the user hands you a plan path under ~/plans-vault or a plankeep MCP path)
---

# Executing a PlanKeep plan

Working protocol for implementing a plan document that lives in the PlanKeep vault.

1. Read the full plan (`get_document` or the file directly) before any work.
2. Call `report_plan_state { path, state: 'working' }` when starting.
3. Check off `- [ ]` items via file edits as steps complete (this feeds activity tracking + auto-done); update the plan's checkboxes rather than keeping private notes.
4. Whenever stopping before completion — user question, blocker, context exhaustion, end of turn with work remaining — call `report_plan_state { path, state: 'waiting', note: '<why, one line>' }`. Never leave a plan silently mid-flight.
5. When every phase is verified done, call `report_plan_state { path, state: 'done' }` (auto-done will usually have flipped it already; the call is idempotent and clears the note).
6. When a plan spawns follow-up docs (findings, sub-plans), pass `derivedFrom` (the plan's path or id) to `save_document` so they nest under it in the vault tree.
7. Pin the `vault` param on every plankeep MCP call if the user has multiple vaults (`list_vaults`).
8. Never `git push` the vault or the project repo unless explicitly asked.
