# Layer 5 plan: the artifact contract (tools, results, first artifact)

Draft 2026-11-05. Builds on `ddl/base` (layers 1 to 4 closed, 3b merged). Layer 5 is where NOVA first becomes
usable from Claude: the MCP tools that Claude and artifact pages call, the shape of what they return, and the first
real artifact (**Habits**, Lucas's pick). 3c (erase and feed) and 3d (backup, restore, deletion drill) still gate **real
data**; layer 5 runs against the **sandbox** store until the drill passes.

## Starting point
- 80 read queries with coverage columns (`db/views/`), the generic write registry with descriptors and rules in the
  transaction (`LedgerDO.write`), the Control DO and OAuth in `src/auth`, `src/control`, `src/worker`.
- `src/mcp/server.ts` still registers the Phase 0 shell tools (`nova.open`, `navigate`, `view.poll`) and `compat.*`.
- Settled preferences: America/Chicago, Sunday weeks, USD, Habits first (`docs/PREFERENCES.md`).
- Host facts (`docs/research/ARTIFACT_OS_FINDINGS.md`): artifact MCP access documented on web and desktop; published
  artifacts have 20 MB text storage; artifacts that use connected apps cannot be shared by link; no documented limits
  on tool count, description length, timeouts or result size; whether a page can read `structuredContent` is unconfirmed.
  Lucas chose to skip the device test kit, so the design below must work without those answers.

## Principles
1. **Artifact pages are untrusted callers.** The host's read-only or app-only labels are not a boundary (observed). Every
   rule is enforced server-side: validation, rules in the transaction, idempotency, attribution.
2. **A small, stable tool surface.** The model and pages discover queries at run time instead of one tool per view.
3. **Results are JSON the page can parse whatever the host does.** Always return the full result as JSON **text**, and
   also as `structuredContent` when the host passes it.
4. **State lives on the server, never in the page.** Pages may cache for speed only.
5. **No real data until the deletion drill passes.** Tools operate on the sandbox store while `NOVA_STORE_MODE=sandbox`.
   The tool inputs have no `store` parameter, so a model or page can never pick the real store by mistake.

## Tool surface (v1)
| Tool | Kind | What it does |
|---|---|---|
| `nova.describe` | read | Lists views and write verbs: id, room, question answered, parameters (name, type, required), columns. Optional `room` filter. Returns JSON. |
| `nova.read` | read | Runs one catalogued view: `{ view, params }` returns `{ ok, view, columns, rows, coverage, truncated }`. The Worker validates parameters from the view metadata, fills `limit`, converts a `local_date` into the day's UTC bounds using America/Chicago (the adapter binds named parameters positionally as Durable Object SQLite requires), and caps rows (100) and bytes (64 KB) with a `truncated` flag. |
| `nova.write` | write | The generic registry: `{ client_op_id, sources, writes }` exactly as `docs/layer3/3B_CONTRACT.md`. Returns the receipt or a safe error code. |
| `habits.log` | write (verb) | Log a habit performance with defaults: `{ client_op_id, habit, status, said, date?, quantity?, duration_seconds?, reason?, context? }`. `said` is the user's own words (or "tapped in the Habits page"); the server stores it as the evidence source, resolves the habit, sets the attribution date (default today in America/Chicago), and calls the registry. |
| `host.check` | read | Returns what the server can observe about this call (timing, result sizes, contract versions) for the "Check host" button. |

More verbs are added **only when a room's artifact needs them** (for example `body.log_workout`, `schedule.add_block`),
always as thin wrappers over `nova.write`. `nova.open`, `navigate` and `view.poll` stay as they are for layer 6;
`compat.*` is retired at the end of layer 5.

### Why few tools
The host publishes no tool-count or description limits, 80 view-tools would be heavy and fragile, and a pair of
generic tools plus discovery lets Claude build any room's artifact from the same contract.

## Result and error contract (`read-1`)
```ts
type ReadReply =
  | { ok: true; contract_version: 'read-1'; view: string; columns: string[]; rows: Record<string, unknown>[]
      coverage?: { known: number|null; unknown: number|null; expected: number|null; from: string|null; to: string|null; basis: string }[]
      truncated: boolean; generated_at: string }
  | { ok: false; code: 'unknown_view'|'invalid_params'|'too_large'|'store_unavailable'|'rate_limited'; detail?: string }
```
Rows are exactly the view's columns; unknown stays `null` (never `0`); every number that has coverage carries it.
Writes return the registry's `WriteReply`. Errors never contain SQL, secrets or stack traces.

## Identity and attribution
- All writes arriving over MCP are stamped `captured_by = 'model'` (honest: an AI-reachable channel entered them);
  `asserted_by` is `'user'` when the tool says the content is the user's report, `'model'` for NOVA's own proposals.
  The widget confirm path (layer 6) may later stamp `captured_by = 'user'` for taps the server can prove.
- The tool layer, not the caller, chooses these values; the request body cannot.

## Store selection and safety
- `NOVA_STORE_MODE` (`sandbox` now, `real` only after the drill and an explicit config change) selects the store via the
  existing Control DO routing. No tool accepts a store, handle or session argument.
- Rate limits per owner and per tool (a page can loop); `nova.write` stays idempotent by `client_op_id`.
- A kill switch: a Worker variable disables all writes while reads keep working.

## Artifacts
- **Style guide** (`docs/artifacts/STYLE_GUIDE.md`): how Claude builds a NOVA page. Call `nova.describe` first, never
  hard-code SQL or table names, render coverage with every number ("7 of 14 days reported"), show unknown as unknown,
  keep pages offline apart from tool calls, generate one `client_op_id` per user action and reuse it on retry, show a
  receipt after every write, use the Sunday-week and Central-time conventions, and include a **Check host** button.
- **Habits artifact (first):** today's habits with one-tap done / partial / not done / skipped-with-reason, streaks with
  coverage and pauses (HAB-02), week view (HAB-01), reasons and context (HAB-04), automaticity (HAB-05), definition history
  (HAB-06). Claude builds and republishes it from `docs/artifacts/HABITS_SPEC.md` (what to show, which views, which verb).
- **Check host button:** one tap reports structured-result support, per-call latency (cold and warm), contract versions,
  the last error, and what the consent prompt did, so one screenshot replaces the device kit.
- **Offline harness** (`test/artifacts/`): renders an artifact in headless Chrome against a stub host that answers tool
  calls from the Node view runner and the registry, so a generated page is tested without a phone.

## Build plan
| Step | What | Lanes (Codex) | Claude |
|---|---|---|---|
| 5a Server tools | `docs/layer5/5A_CONTRACT.md`: view metadata module and adapter, `nova.describe`, `nova.read`, `host.check` (lane `tools5a`); `nova.write`, `habits.log`, attribution, store mode, rate limits, kill switch (lane `write5a`); contract and hostile-input tests | 2 lanes | wire both into `server.ts`, retire `compat.*`, review, first deploy over the existing Worker |
| 5b Harness and guide | offline stub-host harness; style guide and Habits spec | 1: harness; Claude writes the guide and spec | review |
| 5c Habits artifact | Claude builds and republishes the page in chat on the sandbox store; Check host run | none | iterate with Lucas |
| 5d Next rooms | Body, Schedule, Mind artifacts, one at a time, each with its verbs and a spec | 1 per room if new verbs | review |

## Cloudflare and what Lucas does
**Reuse the existing Worker and identity setup; do not build a new Cloudflare structure.** The MCP server code is the same
code base (`src/mcp`, `src/auth`, `src/control`), and the identity pieces already exist for the deployed Worker
`nova-compat`: its Cloudflare Access OIDC application and owner-only policy, the OAuth KV namespace, and the Worker secrets
`ACCESS_CLIENT_SECRET` and `ALLOWED_EMAIL` (Worker secrets persist across deploys). Deploying the rebuilt code **over the same
Worker** therefore needs none of that re-entered. What changes:
- **Durable Object storage is reset.** The deployed Ledger and Control objects hold the Phase 0 schema, which the rebuilt code
  refuses (checksummed migrations). All of it is synthetic, so a migration pair deletes and recreates both classes
  (`deleted_classes`, then `new_sqlite_classes`, appended after the recorded tags v1, spike-s1, spike-s1-remove). Claude does this.
- **One new secret: `RETRY_HMAC_SECRET`** (the retry digest key). It is random, so Lucas generates and stores it with one
  command that never prints it: `$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b) | npx wrangler secret put RETRY_HMAC_SECRET --config wrangler.compat.jsonc`
- **New variables** (not secrets, Claude sets them in the config): `NOVA_STORE_MODE=sandbox`, `NOVA_WRITES_ENABLED=true`,
  the rate variables.
- **The connector keeps its URL**; Lucas removes and re-adds it (or refreshes it) in Claude so the new tool list loads.
- **workers.dev address stays on** (Lucas, 2026-11-05: `workers_dev: true` in `wrangler.compat.jsonc`), so deploys need no dashboard step. The
  endpoint is still owner-only: `/mcp` requires an OAuth bearer from Cloudflare Access; `preview_urls` stay off.
- **Rollback:** the old code is the git tag `legacy-fitness` and a previous Worker version in Cloudflare; only synthetic data is lost.
- **Alternative (only if wanted):** a separate `nova-dev` Worker keeps `nova-compat` untouched, but needs a new Access
  application (or a second redirect URL on the existing one), a new KV namespace and re-entering `ACCESS_CLIENT_SECRET` and
  `ALLOWED_EMAIL`, which is the slow part Lucas wants to avoid.
Lucas runs `npx wrangler login` himself; Claude never enters credentials. Nothing real enters the store.

## Gate (before Habits is used with real data)
1. Tool schema and contract tests pass; hostile-input tests (oversized params, unknown views and tables, a supplied
   `store`, forged server-owned columns, replayed and conflicting `client_op_id`) are all rejected safely.
2. Every `nova.read` result carries coverage where the view does, `null` for unknown, and respects the caps; a result over
   64 KB truncates with the flag.
3. The offline harness renders the Habits artifact from stub results and checks unknown handling, coverage text and receipts.
4. On the deployed sandbox, Claude builds and republishes the Habits artifact, Lucas logs a habit and sees it round-trip,
   and a Check host screenshot is on file.
5. 3c and 3d are done and the deletion drill has passed **before** the store mode is changed to `real`.

## Decisions needed from Lucas
1. **Few generic tools plus verbs (recommended)** versus one tool per view.
2. **`captured_by = 'model'` for every MCP write (recommended)**, with `'user'` reserved for the proven-tap path in layer 6.
3. **Sandbox-only until the drill passes, with no `store` parameter in any tool (recommended).**

## Risks
- Tool descriptions are what steer the model: too long and they cost tokens and get ignored, too short and writes
  misfire. The harness and contract tests cover the server; description quality is tuned in 5c.
- Result size and latency on the real host are unknown; the 64 KB cap and the Check host button are the mitigation.
- The host may change artifact connector behavior (consent, limits). Exit path: the same MCP server behind a standalone
  page (research doc, question 11).
- A page can call `nova.write` as freely as the model can; the rules, descriptors and rate limits are the protection.
