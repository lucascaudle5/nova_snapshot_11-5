# NOVA: instructions for Claude Code in this repository

Read `docs/HANDOFF_2026-11-05_LAYERED_BUILD.md` first. It holds the state of the build, the branches, the deploy facts and the open work.

## Who and how
- The owner is Lucas (Warrior, Alabama; America/Chicago). Keep replies short and in plain language. Say what a command will do before running it.
- Working split: **Claude plans, writes the Codex lane prompts, sets up lane clones, reviews, merges, verifies and deploys; Codex ("Luna") writes the code** from prompts Lucas pastes into Codex himself. Do not write large features directly unless Lucas asks.
- Separate "reported" (what a Codex lane said) from "observed" (what you ran yourself). Re-run the checks on every merged lane before trusting it.
- Never enter credentials for Lucas. He runs `npx wrangler login` and any secret command himself.
- Ask before deploying. Deploy only with `npx wrangler deploy -c wrangler.compat.jsonc` (a bare `wrangler deploy` uses the old local-dev config and creates stray resources). Stay in `NOVA_STORE_MODE=sandbox` until Lucas says go real.
- Push only the branches Lucas has said to push. The repo `lucascaudle5/NOVA` is private.
- Delete nothing in Cloudflare or GitHub without Lucas's explicit yes.

## Commands (Windows, Git Bash or PowerShell)
- `npm_config_engine_strict=false` for npm. `npm run build:schema` (runs `build:views` first), `npm run build:descriptors`, `npm run build:widget` before the workers tests.
- Checks: `npm run typecheck`, `lint`, `test:unit`, `test:workers`, `test:db`, `check:ci`, `npm run check` (adds browser tests, 6 skipped by design).
- **Never run two test, build, sweep or mutation commands at the same time.** Concurrent runs corrupt generated files and give false failures.
- `scripts/ci-policy.ts` is a strict manifest of `package.json` scripts: a new script needs its literal added there and in its unit test.
- Generated modules are git-ignored (`src/ledger/generated-*.ts`); rebuild after a fresh clone.
- Windows line endings: edit files with scripts that normalize `\r\n`, not shell heredocs with backslashes.
- Use a junction for `node_modules` in extra clones or worktrees.

## Principles that must not be broken
Unknown is NULL, never zero. A miss stays a miss (only an explicit `not_done`). Planned pauses preserve streaks. Weeks start Sunday. USD only. Nothing is inferred that a source did not say. Erasure is hard erasure with an all-NULL stub; erased content never reaches a reply, log, feed, export or report. Retries reuse the same `client_op_id`. See `docs/PREFERENCES.md`, `docs/schema/CONVENTIONS.md` and `docs/layer3/3C_CONTRACT.md`.
