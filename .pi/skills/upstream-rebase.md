---
name: upstream-rebase
description: Sync this fork against upstream/main on a fresh throwaway branch, rebuild and test with all fork patches, fix conflicts iteratively (asking the user when ambiguous), then wait for user validation before tagging and promoting cj-main. Use when asked to "rebase on upstream", "sync the fork", "upgrade our fork", or "fetch upstream".
---

# Upstream Rebase + cj-main Promotion

End-to-end workflow for keeping this fork (`origin` = public fork, `upstream` = badlogic/pi-mono) current. Codifies the runbook in `AGENTS.local.md` (gitignored, holds internal-only details) plus the interactive gates the user expects.

Hard rules:
- This is destructive-adjacent work on `cj-main`. Never touch `cj-main` directly until the very end, and only with the user's explicit go-ahead.
- Never open PRs to upstream. Keep everything on local branches/tags.
- Follow `AGENTS.local.md` "Internal name hygiene" — this fork is public. No internal hostnames, gateway names, or internal model ids in committed files.

## 0. Read the runbook first

Always read `AGENTS.local.md` at repo root before starting. It carries:
- the recurring conflict patterns and which side to take,
- merge-vs-rebase guidance,
- the validation order,
- the live Anthropic cache test invocation (internal gateway details live there, not here).

If `AGENTS.local.md` is missing or stale, ask the user before proceeding.

## 1. Survey the gap

```bash
git status && git branch --show-current
git fetch upstream
git log --oneline cj-main..upstream/main | head -30   # what's incoming
git log --oneline upstream/main..cj-main --no-merges    # our patches
# scan upstream's Breaking Changes / Removed for things our fork or exts rely on:
git show upstream/main:packages/coding-agent/CHANGELOG.md | rg -iA2 'Breaking Changes|Removed' | head -60
```

Summarize for the user: how many incoming commits, how many fork patches, any relevant Breaking/Removed entries, and any plan doc under `cj/` (e.g. `cj/upstream-rebase-plan-*.md`).

## 2. Fresh throwaway branch + safety tag

```bash
git tag cj-main-pre-rebase-$(date +%F) origin/cj-main
git checkout -b cj-main-upstream-rebase-$(date +%F) cj-main
```

Tag pattern is `cj-main-pre-rebase-YYYY-MM-DD` (check existing with `git tag | rg '^cj-'`).

## 3. Conflict surface dry run

Per `AGENTS.local.md`, a single merge usually beats rebase here (fork patches touch the same files repeatedly, so rebase replays the same conflict 4+ times). Confirm the surface first:

```bash
git merge --no-commit --no-ff upstream/main
git status --short | rg '^UU' | wc -l   # count real conflicts
git merge --abort
```

Tell the user the count and whether you'll merge or rebase. Default to merge unless the user asked for rebase or the history is trivial.

## 4. Resolve conflicts iteratively

Always set `GIT_EDITOR=true` so git never opens an editor.

For each conflicted file:
1. `rg -n "<<<<<<<|=======$|>>>>>>>" <file>` to locate markers.
2. Match against the known patterns in `AGENTS.local.md` (scope rename, openai-completions compat struct, extensions loader, lockfiles, etc.).
3. Resolve, then re-grep to confirm zero markers remain before `git add`.

When a conflict is **ambiguous** — i.e. it does not match a documented pattern, both sides carry real semantic changes, or you cannot tell which behavior the user wants — STOP and `intme` (interview, one question at a time, with your recommended answer). Do not guess on ambiguous semantic conflicts.

Lockfiles: never hand-merge. `git checkout --theirs package-lock.json` then `rm -rf node_modules package-lock.json && npm install`. Stay on npm; delete any `pnpm-lock.yaml`.

Finish with `git merge --continue` (or `GIT_EDITOR=true git rebase --continue` per step).

## 5. Validate (in this order)

Run the validation order from `AGENTS.local.md`. Currently:
1. `npm install` (lockfile / deps settle)
2. `npm run check` — must exit 0 (fix all errors/warnings/infos)
3. `npm run clean && npm run build` — required; stale paths in `dist/` break tests
4. cj tests: `npx vitest --run cj/tests/`
5. Targeted package tests listed in the runbook (openai-completions cache, prompt-history, settings-manager, etc.)
6. Live Anthropic cache test if `openai-completions.ts` changed — invocation + pass criteria are in `AGENTS.local.md`.

Common post-rebase fixups: `.js`→`.ts` relative imports in cj tests, version bumps to match upstream, regenerate shrinkwrap (`npm run shrinkwrap:coding-agent`).

Commit the cleanup on the throwaway branch (stage only your files; `PI_ALLOW_LOCKFILE_CHANGE=1` if the lockfile is part of the change).

## 6. Audit silent obsoletions (auto-merged breakages)

The most dangerous regressions leave **no conflict marker**: when upstream edits a line our fork also touched in a similar-looking way, git auto-merges and silently flips behavior. Green checks + green tests do NOT catch these if no test covers the path. After validation, audit explicitly:

1. **Diff fork-feature files across the rebase** and eyeball semantic flips:
   ```bash
   git diff cj-main-pre-rebase-$(date +%F) HEAD -- <fork-feature-file>
   ```
   Prioritize the files our feature patches touch (`git log --oneline upstream/main..cj-main --no-merges` → `--stat`).
2. **Cross-check upstream's Breaking Changes / Removed** (from step 1) against fork + extension reliance. Recurring offenders: tool `execute` signature order, `@sinclair/typebox` → `typebox` (the `/compiler` shim was dropped — import `Type` from `@earendil-works/pi-ai` or `typebox`), `--no-context-files` gating, ext `ctx` shape.
3. **Known recurring silent flip:** `examples/extensions/question.ts` + `questionnaire.ts` guard. Upstream keeps setting `if (ctx.mode !== "tui")`; we require `if (!ctx.hasUI)` (breaks Supacode/RPC otherwise). Grep both files and revert. See `AGENTS.local.md`.
4. **External extension dirs are not in this repo** (CJ's dotfiles exts, `~/.pi/agent/extensions/`) so scope/import migrations (`@mariozechner` → `@earendil-works`, typebox) never show as conflicts. The `cj/tests/` suite imports and exercises several of them — `npx vitest --run cj/tests/` is the canary. If an ext import broke, fix it in its source dir (dotfiles repo, committed separately) and rerun.

## 7. Rebuild the user's binary

`~/bin/pi` symlinks to `packages/coding-agent/dist/cli.js`, so step 5's build already refreshes it. Note: `examples/extensions/*` are NOT bundled into `dist/` — they load from source via jiti, so ext fixes land on the user's next reload without a rebuild. Confirm:

```bash
ls -la ~/bin/pi && pi --version
```

## 8. WAIT for user validation

Do not promote. Report status (conflicts resolved, checks green, tests green, binary rebuilt) and hand off to the user to dogfood. Only continue when the user explicitly says it works / to promote.

## 9. Tag + promote cj-main

Only after the user confirms:

```bash
git tag cj-main-rebased-$(date +%F) HEAD
git checkout cj-main
git merge --ff-only cj-main-upstream-rebase-$(date +%F)
```

If the user asks to push, push explicitly (never `git push` blindly):

```bash
git push origin cj-main
git push origin cj-main-pre-rebase-$(date +%F) cj-main-rebased-$(date +%F)
```

## 10. Update the runbook

If you learned a new conflict pattern, silent-obsoletion, baked-in decision, or validation step, append it to `AGENTS.local.md` so the next rebase is cheaper.
