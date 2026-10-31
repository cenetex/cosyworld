# Work on the current CosyWorld game

Use simple English. Keep the original project folder on `main` and make changes
in a separate worktree on a `codex/` branch. Commit, push, and open a PR for each
code change. Preserve other contributors' files and local settings.
Push early: open a draft PR from your first commit and keep pushing work in
progress, so stopped work is never stranded on a local branch.

Before feature work:

1. Check `git status --short --branch`, the current commit, and the package version.
2. Fetch `origin/main` and compare the worktree with it. Start new work from the
   current main commit; continue an existing feature from its own branch.
3. Read `docs/current-game.md`, `CLAUDE.md`, and the implementation that serves
   the requested game. For live work, read `/meta`: `primary_game` identifies
   the root page and `card_game` identifies the current catalogs and rules.
4. Build current gameplay in `v2/card-game/`. Follow its actual imports for
   characters, packs, dialogue, and shared rules.
5. Treat `docs/archive/` as history. Classic packs and metadata describe the
   compatibility runtime. Use those sources for an explicit classic task.

The current card game supports local saves and shared worlds. The forest cast,
shared human avatars, character profiles, and mounted packs all contribute to
its cast. Their source paths are listed in `docs/current-game.md`.

Keep each branch small: at most 400 hand-written lines changed against main.
The pre-push hook enforces this budget; see `.github/AGENT.md`.

CI runs only by hand. PRs merge on fast local checks and review. After a
batch of merges, or when .dev looks broken, run `gh workflow run ci.yml --ref
main`. A release tag requires the latest main CI run to be green.

Pull requests do not bump the version. Between releases, main and `.dev` carry
the last released version; `/meta.commit` names the deployed commit.

Validation and release follow `.github/AGENT.md` and `docs/release.md`.
