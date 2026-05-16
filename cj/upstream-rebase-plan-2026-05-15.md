# Upstream Rebase Plan — 2026-05-15

Working branch: `cj-main-upstream-rebase-2026-05-15` (already created, off `cj-main`)
Do NOT touch `cj-main` until plan is fully validated and approved.

## Summary of upstream/main since last rebase

- merge-base: `30298368` → `upstream/main` is now at `b4ee3aae`
- 151 commits upstream, 41 commits on cj fork
- 33 files overlap between fork edits and upstream edits, but only **6 hard merge conflicts**
- two upstream releases happened: **v0.73.1** and **v0.74.0**

### Big upstream themes
1. **`@mariozechner` → `@earendil-works` package scope rename** (commits `3e5ad67e`, `551385e4`). Hits every package.json, every import in src/tests/docs.
2. **Agent harness refactor (`bigrefactor` branch)** — new `packages/agent/src/harness/` tree with session/compaction/env modules. Old paths in `coding-agent/src/core/{messages,compaction}` still exist alongside new ones (compat), so nothing breaks immediately.
3. **TUI fixes**: kitty image ids, portrait image height cap, markdown.ts robustness, list-item indent wrapping, todo checkbox render, image render placement.
4. **AI providers**: Together AI added; Bedrock proxy agents; OpenAI 429 retry-after; Fireworks session affinity; Codex SSE/websocket; mixed chat completion deltas.
5. **Coding-agent**: terminal restore on uncaught exception, retry Anthropic message_stop endings, hyperlink update changelog, disambiguate resource paths, Option-key on macOS.
6. **Build/release**: Windows ARM64 binary, linux binary build restore, `cli-highlight` replaced, small deps killed.

## Does anything make our fork's changes obsolete?

| Fork change | Upstream effect | Action |
|---|---|---|
| `feat(coding-agent): cross-session prompt history` (`prompt-history.ts`) | not present upstream | **Keep** |
| `feat(coding-agent): per-directory prompt history` | not present upstream | **Keep** |
| `feat(coding-agent): allow --resume/-r prefix` | not present upstream | **Keep** |
| `feat(coding-agent): pi.getSettings()` + `settings-manager.ts` | not present upstream | **Keep** |
| `feat(coding-agent): native RTK bash rewriter` | not present upstream | **Keep** |
| `subagent: model override`, project agents, default scope, supacode signal | not present upstream | **Keep** |
| `question/questionnaire`: multi-select, force-other, Space select, wrap-long-text | not present upstream | **Keep** (but conflicts with upstream's `@earendil-works` rename — trivial) |
| Anthropic `cache_control` for openai-completions proxies (4 commits) | not present upstream; Together added similar `disableAnthropicCacheControl` flag | **Keep + reconcile** with `isTogether` flag (see Conflict 1) |
| `fix: drop malformed toolCall blocks` (`agent-loop.ts`) | upstream snapshotted turn state but didn't drop malformed | **Keep** |
| `feat: assistant response timing` (`agent-loop.ts`) | not present upstream | **Keep** |
| Frontmatter parser hardening | not present upstream | **Keep** |
| @ file search via `fuzzyFilter` | not present upstream | **Keep** |
| `~/.claude/CLAUDE.md` context loading | not present upstream | **Keep** |
| Extension test suite (`cj/tests/`) | not present upstream | **Keep** (will need import rename) |
| `external-context` test trim | not present upstream | **Keep** |
| Frontmatter YAML resilience | not present upstream | **Keep** |
| `wrapTextWithAnsi` import in question/questionnaire examples | upstream removed it from import set | **Keep ours** (we still use it) |
| `spawnSync` import in `bash.ts` | upstream removed it | **Keep ours** if RTK rewriter still needs it (verify) |

**Nothing is fully obsoleted.** The only "near-redundant" overlap is the cache_control story:
- upstream `7adb8e76` added Together AI with `supportsLongCacheRetention: !isTogether`
- we added `disableAnthropicCacheControl: false` for the same struct
- These are complementary. Merge: keep both flags.

## Hard conflicts (6)

All trivially resolvable:

1. **`packages/ai/src/providers/openai-completions.ts`** — combine: `supportsLongCacheRetention: !(isTogether || isCloudflareWorkersAI || isCloudflareAiGateway)` + keep our `disableAnthropicCacheControl: false`.
2. **`packages/coding-agent/examples/extensions/question.ts`** — pure scope rename + we still need `wrapTextWithAnsi` and `connect` from `node:net`. Resolve: take theirs for scope, re-add our extra imports.
3. **`packages/coding-agent/examples/extensions/questionnaire.ts`** — same as #2.
4. **`packages/coding-agent/src/core/tools/bash.ts`** — scope rename + we still need `spawnSync`. Take theirs + re-add `spawnSync` import.
5. **`packages/coding-agent/src/modes/interactive/components/assistant-message.ts`** — scope rename + we keep `Usage` import (used for response timing). Take theirs + re-add `Usage`.
6. **`package-lock.json`** — regenerate, don't hand-merge.

## Soft conflicts / things to watch

- **scope rename** mass replacement — every fork file mentioning `@mariozechner` needs sed to `@earendil-works`. ~30 files in fork-only edits.
- **pnpm-lock.yaml** — fork has it, upstream doesn't. Upstream still uses npm. Decide: keep dual locks or drop pnpm-lock (fork commit `0d4720e7` introduced it).
- **agent-loop.ts** — upstream `322759a3` snapshotted turn state. Our two patches (timing + drop malformed) need to apply on top. Auto-merge succeeded in dry run but eyeball the result.
- **interactive-mode.ts** — 8 upstream commits, no conflict in dry run, but biggest auto-merge risk. Spot-check after merge.
- **harness move** — upstream copied (not moved) `compaction/` and `messages.ts` to `packages/agent/src/harness/`. Old paths still exist. Our edits to `messages.ts` (none) and compaction (none) are unaffected. If a future rebase deletes the old paths we'll need to re-target.
- **versions** — upstream is 0.74.0, fork is 0.73.0. After rebase, bump fork to 0.74.0 (or keep 0.73.0 if we don't publish; check what `~/bin/pi` install path expects).

## Plan

Stay on `cj-main-upstream-rebase-2026-05-15`. Don't touch `cj-main`.

1. **Fetch & confirm baseline** (already done).
2. **Try rebase first** (preserves linear history): `git rebase upstream/main`.
   - If it gets messy with the agent-loop or interactive-mode auto-merges, fall back to **merge** (we already validated 6-conflict merge cleanly).
3. **Resolve the 6 conflicts** as documented above.
4. **Mass-rename `@mariozechner` → `@earendil-works`** across all fork files:
   - `rg -l '@mariozechner' | xargs sd '@mariozechner' '@earendil-works'`
   - Skip `pnpm-lock.yaml` and `package-lock.json` — regenerate instead.
5. **Regenerate lockfile**: `rm -rf node_modules package-lock.json pnpm-lock.yaml && npm install` (mirror upstream's npm). Decide on pnpm-lock separately.
6. **Bump versions** in all `packages/*/package.json` to `0.74.0` to match upstream, sync workspace deps.
7. **Run `npm run check`** — fix any type/lint issues from the harness refactor surface area touching our edits.
8. **Run targeted tests**:
   - `cj/tests/` (our extension regressions) — these already pull from `@earendil-works` after rename.
   - `packages/ai/test/openai-completions-anthropic-cache.test.ts` — validates our cache_control merge still works.
   - `packages/coding-agent/test/{prompt-history,settings-manager,subagent-agents,frontmatter,model-resolver,footer-width,skills,args}.test.ts`.
   - `packages/agent/test/agent-loop.test.ts`.
9. **Smoke test** built binary: `./pi-test.sh` in tmux per AGENTS.md, exercise prompt history, subagent override, question/questionnaire.
10. **Live cache test** (optional, gated): `cj/tests/openai-completions-anthropic-cache-live.test.ts` against devai opus — confirms breakpoint cap still works post-rebase.
11. **Only after all green**: fast-forward `cj-main` to the rebase branch, force-push.
12. **Tag** the pre-rebase tip on `cj-main` first: `git tag cj-main-pre-2026-05-15 origin/cj-main` so we can recover.

## Rollback

If anything explodes:
- `cj-main` is untouched on local + origin.
- Rebase branch can be deleted: `git branch -D cj-main-upstream-rebase-2026-05-15`.
- Stashes from earlier rebase attempts are still in reflog.

## Open questions for cj

- Drop `pnpm-lock.yaml` and stay on npm (matches upstream)? Or keep both?
- Bump our package versions to 0.74.0, or stay 0.73.0?
- Skip the live cache test on this rebase, or run it (costs devai tokens)?
