# Layer 5c: Habits artifact findings

Completed November 5, 2026 on the work machine in `C:\Users\lcaudle\NOVA`, branch `layer5/5c-habits`. No clone, server-code change, deployment, Wrangler command, Cloudflare login, secret access, or real-data operation was performed.

## Deliverables

- Built file: `C:\Users\lcaudle\NOVA\artifacts\dist\habits.html`, **50,428 bytes** (49.25 KiB), below the 120 KB budget.
- Source: `artifacts/habits/habits.src.html`; reproducible build: `npm run build:habits`. CSS and JavaScript from the existing kit are inlined. The generated dist directory stays git-ignored; rebuild after checking out the branch.
- One optional approved Google Fonts stylesheet link; no external script or other asset. The page's CSP blocks remote font binaries and direct connections. Font fallbacks work when the stylesheet is blocked.
- `artifacts/fixtures/generate.mjs` runs the actual HAB SQL over the repo's synthetic in-memory fixture store, preserving column names, nulls, coverage, basis text and correction/revision behavior. The app fixtures include empty-store mode, daily/weekly-count/paused habits, a declared pause, a correction, a deliberate revision and timed routine steps. Generic habit and performance write receipt shapes are present.
- `artifacts/harness/host-app.js` adds app-specific fake-host replies and an accepted-write/lost-response scenario without replacing the original selftest. It mutates calendar/list fixtures for write-flow tests; it is not an implementation of the ledger or a live-server integration test.
- `docs/layer5/HABITS_ARTIFACT_HOWTO.md` gives the exact attachment/paste workflow, a Claude prompt, settings, control descriptions, deliberate gaps and ten sandbox trial steps.
- Six app screenshots: `artifacts/harness/shots/habits-app-{390,768,1200}-{light,dark}.png`. Light/dark phone and desktop renders were visually inspected.

## Behavior and honest limits

Initialization checks host access/date, discovers the Habits views and loads HAB-00. HAB-02 provides report-streak evidence for every listed habit. Selected details use HAB-06/07/10, HAB-01 weekly coverage and HAB-09/08 routines. All range ends are clamped to the server's Chicago local date; wholly future months request no dated outcome/routine ranges. The calendar is Sunday-first; future cells remain Ahead.

Only explicit not_done is a miss. Unknown stays Unknown; pauses preserve without extending the confirmed report streak. Streaks are scoped to the displayed month's evidence window, with latest report, coverage and basis beside them; they are not an all-time or fully observed daily streak claim. HAB-01 targets remain the server's pinned-frequency figures, even for a partial week; the client does not reinterpret them as dated due slots.

In the real-query synthetic paused fixture, HAB-00 returns null latest-report fields after a deliberate revision while HAB-02 still returns two confirmed done reports and the pause. The app uses HAB-02's confirmed evidence and date rather than manufacturing a zero or hiding that evidence. This is an observed fixture/query discrepancy to inspect in live use; its server-side cause was not changed in this lane. A null HAB-10 changed field may mean unchanged or cleared; the page says so instead of reconstructing an unsupported full historic definition.

Writes freeze one UUIDv4 and the entire request for retry. Reason text is paired with reason_code=other only for not_done. Create includes owner-entered text evidence, a report cite, adopted status, Chicago attribution date and a unit for quantity habits. Busy controls prevent competing refresh/navigation from losing the post-receipt calendar refresh. Failed reads/date navigation preserve last good data and mark it stale. Truncation is an incomplete-range error, never silently presented as a total.

The page deliberately has no saved analysis, other rooms, definition edits/pause actions or erase UI. Paused habits cannot be logged by current-name resolution; ask Claude to resume them. Duplicate current names can yield ambiguous_habit and may need disambiguation/renaming in chat.

## Verification observed

All commands ran serially. Node 24.21.0 was used with `$env:npm_config_engine_strict='false'`.

| Check | Result |
|---|---|
| npm run build:schema | Passed; 86 views generated |
| npm run build:habits | Passed; 50,428 bytes |
| npm run typecheck | Passed |
| npm run lint | Passed, including after final artifact-only fixes |
| npm run test:unit | 13 files, 77 passed |
| npm run check:ci | Passed |
| node test/artifacts/run.mjs | 39 passed: 35 Habits app tests plus 4 existing harness tests |
| npm run check | Passed: CI policy, widget/schema build, typecheck, lint, unit, workers and browser |
| Workers within check | 29 files, 175 passed |
| Browser within check | 24 passed, 6 existing intentional skips |

The default parallel unit run twice exceeded the existing metadata test's five-second timeout (about 6.6–7.1 seconds); the other 76 tests passed. Setting `$env:VITEST_MAX_WORKERS='1'` made all 77 pass, including within npm run check. No assertions, timeouts or repository test configuration were relaxed. Use that environment setting for full checks on this machine.

The final interaction/fixture-only refinements were followed by a fresh Habits build, lint and the complete 39-test artifact suite. The comprehensive npm run check had passed immediately before those refinements; no server, widget, unit, package-policy or CI code changed afterward. Database conformance tests were not separately requested or rerun; the fixture generator itself executed the real HAB views.

The generated changes to legacy 5b screenshots from this Windows run were restored to avoid unrelated platform-render churn; only the six new habits-app screenshots are committed. The pre-existing modified `docs/layer3/3b-descriptors-findings.md` was left untouched and uncommitted; no checkout was needed. The pre-existing untracked `prompts/77_ADDENDUM_WORK_MACHINE.md` was also excluded.

## Host bridge: every assumption and live-only gap

1. **API and initialization.** Only `callTool(name,args)`, at the top of the app script, accesses tools. Its tested adapter assumes `window.host.callTool({name,arguments})` exists before initialization and returns a Promise. This is the harness API, not a claim about Claude's real JavaScript API. A different bridge must be adapted there.
2. **Names and discovery.** The adapter currently uses unqualified host.check, nova.describe, nova.read, habits.log and nova.write names. A live host may require connector-qualified names or a discovery/initialization handshake. Discovery must expose HAB-00/01/02/06/07/08/09/10; changing views requires a reviewed mapping, not fake data.
3. **Reply and denial shapes.** Tested replies carry NOVA JSON in structuredContent or in a JSON text content block. Tool errors have ok=false, code and optionally field. Raw details are discarded; field hints use a fixed safe allowlist. Other host-denial, nested, streamed or text-error shapes need explicit adapter normalization. A bare NOVA object is not currently a supported bridge return.
4. **Authentication and consent.** The host must carry the signed-in connector identity and server-selected store; the page supplies no token, owner, store or session. Chat tool availability alone does not establish page access. First-use artifact approval and organizational permissions must be checked in a fresh chat. Per-action approval-only tools may be unavailable to artifacts, as noted in the linked help in the how-to. No live approval/identity routing was tested.
5. **Timing and retries.** The adapter waits up to 20 seconds; live host limits are unknown. Initial consent may outlast that timer. Timeout/rejection does not prove that a write failed; the original call may complete later. Exact-body/same-ID replay is assumed to honor the server contract. There is no automatic retry loop; digest_conflict stops retry.
6. **Dates, contracts and limits.** Successful host.check must supply a valid authoritative America/Chicago local_date and server metrics. The page assumes read-1/write-1 and the documented 100-row cap; it rejects truncated replies. It does not select a store, change server time, turn writes on or bypass a rate limit. Check host's sample timing/bytes do not measure the visible data responses.
7. **Browser and sandbox.** Inline HTML/CSS/JavaScript, timers, Promise, Map, Intl with America/Chicago, CSS grid, matchMedia and secure-context crypto.randomUUID must work. Host CSP must permit the inline app and bridge while retaining the page's font/connect restrictions. If connector calls require page-origin fetch, a different supported host relay is needed; direct network access was not added.
8. **Theme.** An explicit data-theme=light/dark on the artifact root wins. Otherwise CSS follows the system preference, including changes. Host-specific theme messages or a theme value available only on a parent frame are not wired; a live host may need to expose its value on that root.
9. **Lifecycle and persistence.** Only the server is durable. Pending bodies/IDs and last good data live in page memory; refresh/republication/chat changes can lose them. A user must inspect the server before creating a replacement after such a loss. Neither artifact storage nor continuity of sharing URLs or permissions is assumed.
10. **Host coverage.** Local Chrome/fake-host tests do not establish web-versus-desktop equivalence, mobile support, published/shared connector access, consent persistence, actual tool/response quotas, or host accounting. These need the how-to's live sandbox trial. No live chat was opened or published in this lane.

Only layer5/5c-habits is authorized for a normal push to origin after checks; no other branch is changed or pushed. The final pushed commit hash is reported in the task handoff (this document is included in that commit).
