# Layer 5a contract: the NOVA tools

Owned by Claude. Both 5a lanes read this. Decisions accepted by Lucas 2026-11-05: **a few generic tools plus verbs**,
**`captured_by = 'model'` for every MCP write**, **sandbox-only with no `store` parameter in any tool until the
deletion drill passes**. Background: `docs/LAYER5_PLAN.md`. Write semantics: `docs/layer3/3B_CONTRACT.md`. Day math:
`src/time/chicago.ts`. Conventions: `docs/PREFERENCES.md`.

## Ground rules
- **Artifact pages are untrusted callers.** Anything a model can send, a page can send. Validate everything, trust nothing
  from tool arguments for identity, store, or attribution.
- **No tool accepts `store`, `handle`, `session_id`, `owner`, `captured_by`, or any envelope or server-owned column.**
  Unknown keys are rejected (strict zod objects). The store comes from the authenticated identity and the Worker
  variable `NOVA_STORE_MODE` (`sandbox` by default; the existing Control routing resolves it).
- Every reply is JSON: the full object as one text block, and the same object as `structuredContent`. Errors set
  `isError: true` with `{ ok: false, code, detail? }`; `detail` is short and never contains SQL, secrets, paths or stack text.
- Contract versions: reads `read-1`, writes `write-1`. A mismatched `contract_version` is `invalid_params`.
- Nothing in this layer deploys, logs in to Cloudflare, or creates resources. Claude deploys.

## The tools
Registration lives in two modules so the lanes never edit the same file; **neither lane edits `src/mcp/server.ts`**
(Claude wires both in at integration): `src/mcp/register-read.ts` exports `registerReadTools(server, deps)` and
`src/mcp/register-write.ts` exports `registerWriteTools(server, deps)`. Both follow the existing pattern in
`src/mcp/navigation-service.ts` (a plain `invoke...(env, identity, args)` service function that tests call directly,
plus a thin registration that wraps it). Tool annotations: `nova.describe`, `nova.read`, `host.check` are read-only;
`nova.write` and `habits.log` are not read-only and not destructive.

### `nova.describe` (read, lane `tools5a`)
Input: `{ room?: string }` (one of the 11 room names, optional). Output:
```ts
{ ok: true, contract_version: 'read-1',
  views: { id: string; room: string; title: string; answers: string; params: { name: string; type: 'TEXT'|'INTEGER'|'REAL'; required: boolean }[]; columns: string[] }[],
  verbs: { name: string; room: string; summary: string }[],   // currently: habits.log, body.log_workout, mind.log_entry, mind.log_medication_use, schedule.place_signal
  conventions: { time_zone: 'America/Chicago'; week_start: 'sunday'; currency: 'USD'; unknown: 'null, never zero' } }
```
Parameter names are reported without the leading colon. Views whose parameters include `day_start_utc` and `day_end_utc`
also accept a single `local_date` (see below), and `describe` says so in the parameter list (`local_date`, optional) so Claude
can discover it. The list is generated from `db/views/*.sql` at build time (the lane writes the generator).

### `nova.read` (read, lane `tools5a`)
Input: `{ contract_version: 'read-1', view: string, params?: Record<string, string|number> }`. Behavior:
1. Unknown view: `unknown_view`. Undeclared, missing or mistyped parameters: `invalid_params` naming the parameter.
2. `local_date` (YYYY-MM-DD, Central) is accepted when the view declares `day_start_utc` and `day_end_utc`; the Worker fills them
   with `localDayBounds`. Supplying both `local_date` and either bound is `invalid_params`.
3. `limit` defaults to 100 and is capped at 100 here (the view runner allows 500; the tool is stricter).
4. Runs the query on the Ledger Durable Object with **positional binding in order of first occurrence** of each named
   placeholder (a Durable Object requirement), inside a read-only call.
5. Output `{ ok: true, contract_version: 'read-1', view, columns, rows, coverage?, truncated, generated_at }`. `coverage`
   is built from the `cov_*` and `basis` columns exactly as `db/views/run.mjs` does. Rows keep `null` for unknown.
   **Size cap:** at most 100 rows and 64 KB of JSON; if either is exceeded drop trailing rows until it fits and set
   `truncated: true` (and add `detail` suggesting a narrower range). Never cut a row in half.
6. Query failures return `store_unavailable` (no raw error text). A view that returns a database error is a bug and is
   logged to the test output only; it must not reach the caller.

### `host.check` (read, lane `tools5a`)
Input: `{}`. Returns what the **server** can observe: `{ ok, contract_versions: ['read-1','write-1'], server_time_utc,
local_date, store_mode: 'sandbox'|'real', view_count, query_ms: number, result_bytes: number }` where `query_ms` and
`result_bytes` come from a fixed internal sample read so the page can show cold and warm timings. (The page measures its own
call latency; this tool supplies the server side.)

### `nova.write` (write, lane `write5a`)
Input is the registry request: `{ contract_version: 'write-1', client_op_id, sources?, writes, asserted_by?: 'user'|'model' }`
with the same shapes as `docs/layer3/3B_CONTRACT.md`. The tool layer builds the server-owned `caller`:
`{ asserted_by: input.asserted_by ?? 'user', captured_by: 'model' }`. `asserted_by` is the **only** attribution a caller may
influence, and only between those two values. Output is the registry `WriteReply`, with the extra code `writes_disabled`
(kill switch) and `rate_limited`. The Worker calls `LedgerDO.write` for the route resolved from the identity.

### `habits.log` (write verb, lane `write5a`)
Input (strict): `{ client_op_id, habit: string, status: 'done'|'partial'|'not_done'|'unknown', said: string,
date?: 'YYYY-MM-DD', quantity?: number, duration_seconds?: integer, reason_code?: string, reason_text?: string, context?: string }`.
- `habit` is a habit id (any revision id of it) or a case-insensitive exact name of a **current adopted** habit. If a name
  matches zero habits: `habit_not_found`; more than one: `ambiguous_habit` with `candidates: {id, name}[]` (max 5).
- `said` (1 to 2000 characters) is the user's own words, or `"tapped in the Habits page"`. It becomes the evidence source
  (`medium: 'text'`, `original_text: said`) cited with role `report`.
- `date` defaults to today in Central time (`localDateOf(now)`); the write sets `attribution_date`, `time_zone: 'America/Chicago'`,
  `attribution_basis: 'user_selected'` when `date` is supplied and `'derived'` when defaulted. A date in the future is
  `invalid_params`.
- It creates one `habit_performances` row pinned to the resolved current habit revision. Fields not supplied are omitted
  (unknown stays unknown). `reason_code`/`reason_text` are allowed only with `status: 'not_done'` (the table's own rules apply
  and the registry enforces them).
- Output: the registry receipt plus `{ habit: { id, name }, date }`. Same `client_op_id` and body is a safe replay.

## Store mode, rate limits, kill switch (lane `write5a`)
- `NOVA_STORE_MODE` (`sandbox` | `real`, default `sandbox`) and `NOVA_WRITES_ENABLED` (`true` | `false`, default `true`) are
  parsed in `src/worker/config.ts` with zod. `real` requires `NOVA_REAL_STORE_ACK=drill-passed` or
  `NOVA_REAL_STORE_ACK=owner-accepted-limits-2026-11-05`;
  without it the Worker refuses to start in `real` mode.
- Rate limits per owner and per tool, sliding window in the Control DO: reads 120 per minute, writes 30 per minute
  (variables `NOVA_READ_RATE_PER_MIN`, `NOVA_WRITE_RATE_PER_MIN` override). Over the limit: `rate_limited` with no work done.
- With `NOVA_WRITES_ENABLED=false`, `nova.write` and all registered write verbs (`habits.log`, `body.log_workout`, `mind.log_entry`, `mind.log_medication_use`, `schedule.place_signal`) return `writes_disabled` immediately; reads keep working.

## Layer 5e: owner erase and backup tools

These tools resolve the owner and current logical store from the authenticated identity. Tool inputs are strict; there is
no caller-selected store, owner, handle, or backup location. Erasure uses the existing Layer 3 erase protocol and export
uses the existing signed, chunked Layer 3 export protocol.

### `nova.erase_plan` (read, `erase-1`)

Input: `{ contract_version: 'erase-1', targets: UUIDv4[] }` (1–200 record revision IDs). Output is the existing
`erasePrepare` plan: `{ ok: true, plan_hash, incarnation, high_water, roots: { root_id, revision_ids[] }[], dependents:
{ root_id, table, via, revision_ids[], suggestion }[], artifact_uris_count, affected_operation_seqs[] }`. It stores
nothing. The model must read the records first and show the owner what will be erased. It must never invent a `plan_hash`
or erase without the owner's explicit yes in the conversation.

### `nova.erase` (destructive write, `erase-1`)

Input: `{ contract_version: 'erase-1', client_op_id: UUIDv4, plan_hash: lowercase SHA-256 hex, targets: UUIDv4[],
decisions: { root_id: UUIDv4, action: 'erase'|'retain_nonrevealing' }[], confirm: 'ERASE' }`. Output is only the existing
safe erase receipt: client operation ID, erase sequence, opaque record/root IDs, affected operation sequences, dependent
decisions, artifact IDs, and erasure/backup states. It contains no record content or URIs. `writes_disabled` and the
per-owner write rate limit apply. A retry reuses the same `client_op_id`; a stale plan returns the Ledger's safe
`scope_changed` code without writes.

### `nova.erase_status` (read, `erase-1`)

Input: `{ contract_version: 'erase-1', client_op_id: UUIDv4 }`. Output is the existing safe receipt. The read rate limit
applies.

### `backup.export` (owner-triggered write, `backup-1`)

Input: `{ contract_version: 'backup-1', confirm: 'EXPORT', export_id?: UUIDv4, cursor?: string }`. Without an ID it starts
a new export. A bounded call returns either `{ ok: true, export_id, state: 'running', cursor }` for continuation with the
same ID and cursor, or `{ ok: true, export_id, created_at, expires_at, counts, chunk_count, manifest_verified }` when
complete. The completed result verifies the signed manifest and each chunk. It never returns chunk contents or a download
link; the export stays in the owner's R2 bucket. Exports expire after 30 days. The owner triggers this manually, such as
once a month; there is no scheduler or automatic export.

### `backup.status` (read, `backup-1`)

Input: `{ contract_version: 'backup-1' }`. Output: `{ ok: true, exports: { export_id, created_at, expires_at, state, counts
}[] }`, newest first and capped at 20, plus the retention and restore note. Exports expire after 30 days. Restore into a
quarantine is an operator action, not a tool. The read rate limit applies.

## Gate for 5a
Contract tests for every tool at the service level and through the MCP handler with a real authenticated identity (reuse
`test/workers/auth-fixture.ts`); hostile-input tests (see each lane); every one of the 100 views runs through `nova.read` on the
clean-store dump without error; the schema and rule tests, typecheck, lint, unit, workers, DB and browser tests all pass.
