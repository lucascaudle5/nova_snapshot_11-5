# Handoff, 2026-11-05: the layered NOVA rebuild

NOVA is a personal "operating system": one Cloudflare Worker with an MCP connector, plus Claude artifacts (single-file HTML pages) as the screens. It is rebuilt in strict layers (`docs/LAYERS.md`, plans in `docs/LAYER2_PLAN.md` to `LAYER5_PLAN.md`).

## Where things stand
- **Layers 1 to 3 (schema, rules, views, write registry, erasure, feed, export, restore, drill)**: built and tested on synthetic data.
- **Layer 5a to 5b2 and 5e**: tools `nova.describe`, `nova.read` (86 read views, HAB-00 to HAB-10 included), `nova.write`, `habits.log`, `host.check`, `nova.erase_plan`, `nova.erase`, `nova.erase_status`, `backup.export`, `backup.status`, plus `nova.open`, `navigate`, `view.poll` (app-only). Style kit, offline harness and Habits spec in `artifacts/` and `docs/layer5/`.
- **Deployed**: Worker `nova-compat` (`https://nova-compat.lcaudle-nova.workers.dev`, connector path `/mcp`) in **sandbox mode, synthetic data only**. Config `wrangler.compat.jsonc`. A fresh chat with the re-added connector ran a nine-step test and passed. Git tag `sandbox-deploy-1` marks the first deploy.
- **Branch**: everything integrated is on `layer5/5a-integrate` (pushed to GitHub). `main` on GitHub is the old code and was left alone.
- **Latest checks on the integration branch (observed)**: unit 76, workers 175, DB 366, browser 24 passed and 6 skipped by design.

## Decisions Lucas has made
- Do **not** wait for the full deletion drill or the 30-day provider evidence before using the system. He accepts that a deleted record may persist in Cloudflare backups up to 30 days. Start with Habits, then other rooms.
- But **not yet real**: first get the artifacts and pages working in sandbox, then switch. The switch is `NOVA_STORE_MODE=real` with `NOVA_REAL_STORE_ACK=owner-accepted-limits-2026-11-05` (the guard also accepts `drill-passed`). Real mode uses a store completely separate from the sandbox. Ask Lucas before flipping and deploying.
- Backups: a manual monthly export (the `backup.export` tool), no scheduler.
- Habits look: `docs/design/mockup-v1-habits/` is the reference (not mockup-v2, which was a later refinement pass). Fonts: Fraunces and Outfit from Google Fonts with local fallbacks. Weeks start Sunday.
- Health data is Google Health/Fitbit (Google Takeout kept outside the repo, never printed or committed). Music uses Last.fm plus the Extended Streaming History export, no Spotify API.

## Open work, in order
1. **Habits artifact (layer 5c)**: prompt `prompts/77_CODEX_LAYER5C_HABITS_ARTIFACT.md`, branch `layer5/5c-habits`. Not started as of this handoff. Output is one HTML file (`artifacts/dist/habits.html`) plus a how-to for Lucas. The only thing that can confirm the page's tool-call bridge is a live chat with the connector (Claude sessions started before a connector change do not see its tools; test in a new chat).
2. **Try it in a connector chat**, fix what the live host shows, redeploy sandbox if server code changed.
3. **Next rooms (layer 5d)** built the same way: spec, kit, harness, artifact. Views for all rooms already exist.
4. **Go real** (see above), then the owner's first real habits (each created with `envelope.attribution_date` so HAB-00 shows when it began).
5. Later: drill break-it-on-purpose tests (drill9 reported them missing), the six real-Cloudflare drill steps (1, 10, 13, 14, 15, 17), stored-analysis contract for the Second Voice card, HAB-01 future-day handling is a caller rule (clamp `to_date` to today), layers 6 to 8, Ink storage.

## Known gaps and cautions
- Drill: runs on real modules and gives 11 pass, 0 fail, 6 not_run; `real_data_release_allowed` stays false. Its test-only hooks in `ledger-do.ts` are off unless `NOVA_DRILL_TEST_SEAMS=true` (test fixture only).
- Unverified without real Cloudflare: R2 historical object versions, point-in-time recovery bounds, provider logs, deployed restore, R2 expiry.
- Control quarantine tables are in their own migration; internal Ledger tables come from checksummed migration `db/ledger-migrations/004_internal.sql`.
- Two stray resources from a mistaken bare `wrangler deploy` may still exist in Cloudflare: Worker `nova-local` and an empty KV namespace `nova-local-oauth-kv` (id `e33c386900d84229b67d69976c81cd05`). Harmless; Lucas may delete them.
- Deploying took two steps the first time (Cloudflare refuses deleting and recreating a Durable Object class in one deploy); that is already done, so ordinary deploys are single-step.

## Lane workflow
Codex prompts are numbered in `prompts/` (44 to 77). A lane works in its own clone under `C:\Users\lcaud\NOVA-lanes\nova-<lane>` on its own branch with push disabled; Claude fetches the branch, merges into the integration branch, resolves conflicts (usually the marked blocks in `src/ledger/ledger-do.ts`), re-runs every suite, then pushes. On a machine without those clones, a lane can push its single branch to GitHub when Lucas authorizes it.
