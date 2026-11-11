# CosyWorld dev-agent wiki

A task-oriented entry point for agents changing the current card game. Use this
wiki to find the owning source and the evidence a change needs, not as a second
set of rules or a replacement for reading the code.

## Start here

1. Read [AGENTS](../../AGENTS.md), the [source map](../current-game.md),
   [contributor guide](../../CLAUDE.md), and [automated contribution policy](../../.github/AGENT.md).
2. Record your branch, commit, package version, requested outcome and constraints.
   Fetch main; use an isolated `codex/` worktree. Preserve other contributors' work.
3. Read the complete issue and recent comments, then inspect current source and
   active PRs. An unchecked old checklist may describe delivered or superseded work.
4. Choose the authoritative layer and write acceptance evidence before editing.
5. Recheck current main before generating, publishing or landing. Parallel branches
   cannot independently reserve the same next rules version.

## Pick your task

| Task                                                  | Read next                                 |
| ----------------------------------------------------- | ----------------------------------------- |
| Find the owning module or trace an action             | [Architecture](architecture.md)           |
| Change a world, character, rule, save or journal      | [Rules and content](rules-and-content.md) |
| Test, review, merge, deploy or report readiness       | [Delivery and evidence](delivery.md)      |
| Diagnose a surprising result without weakening a test | [Troubleshooting](troubleshooting.md)     |

## Keep the wiki useful

- Link the closest canonical guide rather than copying its full policy or commands.
- Verify claims against the checked-out code. When source and prose disagree, report
  the discrepancy and repair the owning guide; do not silently choose convenient prose.
- Keep active assignments, blockers and validation receipts in issues/PRs. Do not
  freeze current PR numbers, open counts or deployed versions into this wiki.
- Label proposals as proposals. A design note or green synthetic smoke does not
  establish that a feature is mounted, playable, deployed or approved for release.
- Update the affected page with a behavior change. Keep navigation in
  [current-docs.json](../current-docs.json) and run `npm run docs:check`.
- Never put credentials, private saves, mailbox contents or runtime data here.

This is repository documentation, reviewed with the code. The authoritative
workflow remains in the linked contributor and release policies.
