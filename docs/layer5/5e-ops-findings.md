# Layer 5e owner erase and backup tools

Offline implementation on `layer5/5e-ops`; synthetic data only. No deploy, Cloudflare account access, or push.

## Tools and shapes

- **`nova.erase_plan`** — strict `{ contract_version: 'erase-1', targets: UUIDv4[] }`. Returns the existing prepare
  plan: `plan_hash`, `incarnation`, `high_water`, root IDs and revision IDs, dependent table names/revision IDs/suggestions,
  `artifact_uris_count`, and `affected_operation_seqs`. It is read-only and persists no plan; send one decision per distinct
  `root_id` in `dependents`, even when the same root appears in multiple dependent entries.
- **`nova.erase`** — strict `{ contract_version: 'erase-1', client_op_id: UUIDv4, plan_hash: lowercase SHA-256 hex,
  targets: UUIDv4[], decisions: { root_id: UUIDv4, action: 'erase'|'retain_nonrevealing' }[], confirm: 'ERASE' }`.
  Returns only the existing safe receipt: operation ID/sequence, opaque record/root IDs, affected sequences, dependent
  decisions, artifact IDs, and erasure/backup state. It returns no content or artifact URI. Send one decision per distinct
  dependent `root_id`; `scope_changed` is returned for stale hashes before writes. A rejected erase creates no operation, so
  `nova.erase_status` returns `operation_not_found`; retries reuse the exact client operation ID.
- **`nova.erase_status`** — strict `{ contract_version: 'erase-1', client_op_id: UUIDv4 }`; returns the same safe receipt or
  `operation_not_found` when that ID has no erase operation.
- **`backup.export`** — strict `{ contract_version: 'backup-1', confirm: 'EXPORT', export_id?: UUIDv4, cursor?: string }`.
  Starts an export when the ID is absent. Each invocation performs up to 64 existing export steps. An incomplete response
  has `export_id`, `state: 'running'`, and the resumable `cursor`; continue with the same ID and cursor. A completed response
  has `{ export_id, created_at, expires_at, counts: { table: rows }, chunk_count, manifest_verified }`. Verification
  checks the signed manifest and every listed chunk. No chunk body or download link is returned.
- **`backup.status`** — strict `{ contract_version: 'backup-1' }`; returns the newest 20 manifest summaries with export ID,
  creation/expiry time, state, and per-table counts. It states that retention is 30 days and quarantine restore is an
  operator action, not a tool.

## Owner operation

Read the records first, then call `nova.erase_plan`, show the owner the proposed IDs/dependencies in understandable
terms, and wait for an explicit yes in the conversation. Only then call `nova.erase` with the exact plan hash and one
decision per distinct dependent root. Use `nova.erase_status` to inspect a receipt after a retry or incomplete cleanup;
after a rejected call it reports `operation_not_found`. To make a monthly
backup, call `backup.export` with `confirm: 'EXPORT'`; if it returns a cursor, call it again with the same export ID and
cursor until it reports a completed export and `manifest_verified: true`. `backup.status` lists completed exports. Treat a
failed tool response, a non-true verification result, or an export that remains `running` as incomplete; retry/continue
with its returned ID and cursor. The R2 objects remain in the account bucket and are not downloadable through these tools.

## Store selection and safety

The store mode remains `sandbox` by default. `real` mode accepts exactly `drill-passed` or
`owner-accepted-limits-2026-11-05` in `NOVA_REAL_STORE_ACK`. Control routes `real` and `sandbox` to distinct physical
store IDs; workerd tests write into each and assert that neither write appears in the other store. Erase execution and
export creation honor the write kill switch and write rate limit. Status reads use the read rate limit. Input validation
rejects unknown keys, wrong contract/confirm values, malformed UUIDs, and oversized requests.

## Verification and remaining limits

The new workerd coverage exercises plan/execute/status, same-ID retry, stale hash with unchanged operation count, invalid
confirmation, kill switch, rate limit, oversized/hostile inputs, clean all-NULL stubs, clean audit, export verification,
new export after a write, status listing, and 31-day expiry purge. Replies are checked for a synthetic canary and URI
patterns. The existing Layer 3 protocol tests continue to cover broader internals.

No real Cloudflare behavior is verified here: R2 historical object versions, production bucket policies, restore on the
deployed system, and deployed 30-day lifecycle behavior remain unverified. In particular, the R2 binding's ordinary list
does not expose historical versions; the existing export/erase protocol limitation is unchanged. No implementation gap
was identified beyond these real-infrastructure checks.

Final verification: schema/widget build, typecheck, lint, and CI policy passed; unit 76 passed, workers 174 passed, DB
366 passed, browser 24 passed and 6 skipped by configuration. The complete `npm run check` passed.
