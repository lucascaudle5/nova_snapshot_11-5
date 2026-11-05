# Layer 3c and 3d contract: erase, erasure list, change feed, export, restore, drill

Owned by Claude. All six lanes read this. **The adopted design is `docs/schema/CONVENTIONS.md`** (sections "Hard erasure
adopted", "Backups and restore", "Erase operation, receipt, feed and anti-resurrection", "Change feed") and
`docs/schema/DELETION_DRILL.md` (the 17-step gate). This document only fixes shapes, module boundaries and
responsibilities so the lanes can build in parallel; if it disagrees with CONVENTIONS, CONVENTIONS wins and you write the
disagreement in your findings file. Layer 3e updates shared erasure types for durable artifact deletion and restore snapshots.

## Principles
- Nothing real is stored while this is built; every test uses synthetic canary data. No lane deploys, logs in to Cloudflare,
  creates a resource or pushes. R2 is **faked** in tests (workerd provides an R2 test binding; use it or a fake `R2Bucket`).
- Content never leaks: receipts, logs, errors and reports contain only opaque ids, sequence numbers and action codes. Test
  that canary strings never appear in any reply, log line, report or stored operation row after an erase.
- Fail closed: an unavailable erasure list, verifier key, manifest or token store blocks the operation; it never skips a check.
- Everything runs inside the single-threaded Ledger Durable Object; asynchronous calls to other Durable Objects or R2 happen
  **before** entering `transactionSync` or after it commits, never inside.
- Internal only: all of this is reachable only as `LedgerDO` methods and Worker-side modules; no MCP tool is added in 3c/3d.
  (The confirm-each-dependent conversation with Lucas is built as tools at layer 5d; 3c exposes the prepare and execute calls.)

## Module map (who owns what)
| Lane | Owns |
|---|---|
| `list3c` | `src/erasure/erasure-do.ts` (`ErasureDO`), `src/erasure/client.ts`, `src/erasure/fake.ts`, `src/erasure/guard.ts` (anti-resurrection checks used by the write path), `src/ledger/tokens.ts`, the write-path hook in `src/ledger/write.ts` and `LedgerDO.write` (async guard before the transaction), sequence-floor enforcement in `LedgerDO` |
| `erase3c` | `src/ledger/erase.ts` (closure, prepare, execute, status, stubbing), `src/ledger/artifacts.ts` (R2 `ArtifactEraser`), `LedgerDO.erasePrepare/eraseExecute/eraseStatus` |
| `feed3c` | `src/ledger/feed.ts`, `LedgerDO.feedOperations/feedRecords`, cursor and incarnation handling |
| `export3d` | `src/backup/export.ts`, `src/backup/manifest.ts`, `src/backup/scrub.ts`, `LedgerDO.exportStart/exportStep/exportScrub` |
| `restore3d` | `src/backup/restore.ts`, Control migration v4 (quarantine registry) in `src/control/schema.ts` and `control-do.ts`, `LedgerDO` restore-side methods, activation swap |
| `drill3d` | `src/drill/` (the runner and report), `test/workers/drill*.test.ts`, the sandbox-only operator route |
Each lane adds only small delegating methods to `src/ledger/ledger-do.ts` in a clearly marked block
(`// layer3c: <lane>` comments). Claude resolves conflicts there at integration.

## 1. The erasure control (`list3c`)
`ErasureDO` is a **separate Durable Object class** (its own SQLite) implementing `ErasureControl`, one object per store
(`idFromName(physicalStoreId)`), bound as `ERASURE` in the Worker environment. Tables (internal, ids and tokens only):
`erased_ids(id PK)`, `sealed_ops(client_op_id PK)`, `source_tokens(token PK)`, `control(key PK, value)`
(`floor`, `incarnation`). Rules:
- Strict validation of every input (UUID v4 lowercase, token format `v1:<64 hex>`, batch caps 200, count caps 100,000).
- `addErased` writes inside one transaction and returns only after the write is durable; on any failure returns
  `erasure_list_unavailable`. No method returns content, timestamps or reasons; the list holds **ids only**.
- `reserveSequence(count)` raises `floor` by `count` (minimum 1, maximum 10,000) and returns it; the floor never decreases.
- `newIncarnation()` returns a fresh opaque random id and stores it; `incarnation()` creates one on first use.
- `restoreSnapshot()` returns erased record IDs, sealed operation IDs, source-suppression tokens, floor and incarnation from one consistent read; it returns no content.
- A kill-proof fake `createFakeErasureControl()` with the same semantics for other lanes' tests.
**Write-path guard** (also `list3c`): `LedgerDO.write` becomes `async` around the existing sync executor. Before the
transaction it (a) collects every record id the request names (targets, `#`-free FK values that are ids) and rejects any in the
erasure list with `erased` (new code; a target or reference to an erased id never writes), (b) for each new source computes
tokens and rejects a match with `source_erased` (generic; creates nothing, logs no values), (c) checks `sealedOperations` for the
`client_op_id` and returns the safe sealed receipt `result_erased` without executing, and (d) makes sure the local sequence floor
covers the next `op_seq` (`reserveSequence` in blocks of 1,000) so `op_seq` never exceeds the floor. Add the new error codes
(`erased`, `source_erased`, `result_erased`, `erasure_list_unavailable`) to `write-types.ts` consistently.
**Tokens** (`src/ledger/tokens.ts`): `HMAC-SHA-256` with the existing `RETRY_HMAC_SECRET`, domain-separated:
`nova.source.bytes.v1\n<bytes>` and `nova.source.identity.v1\n<provider>\n<external_id>`; output `v1:<hex>`. (Same key, different
domains from the request digest; no new secret.)

## 2. Erase operation (`erase3c`)
One logical operation, one `client_op_id`, one `op_seq` E. Two phases; neither persists a content-bearing plan.
**`LedgerDO.erasePrepare(route, { targets: string[] })`** (read only; each target is any revision id of a record):
returns `{ ok: true, plan_hash, incarnation, high_water, roots: [{ root_id, revision_ids[] }],
dependents: [{ root_id, table, via: 'source'|'record_source'|'annotation'|'link'|'incoming_fk'|'shared_source_consumer'|'child_excerpt',
revision_ids[], suggestion: 'erase'|'review' }], artifact_uris_count, affected_operation_seqs[] }`. It enumerates every revision of each
target root, source aliases and excerpts (`parent_source_id` children), `record_sources` associations, annotations whose
`subject_id` is in the set, links with an endpoint in the set, **incoming references** to any id in the set from any payload
column (use the generated descriptors' `references`), consumers of shared sources, and every operation that created any of it.
`plan_hash` = `HMAC-SHA-256` over the sorted opaque ids of the whole closure (domain `nova.erase.plan.v1`). Nothing is stored.
Output is ids and table names only; the caller shows content to Lucas using ordinary reads.
**`LedgerDO.eraseExecute(route, { client_op_id, targets, decisions, plan_hash })`** with
`decisions: { root_id, action: 'erase'|'retain_nonrevealing' }[]` (one per dependent root, none omitted). Steps:
1. Strict validation; `sealedOperations`/`operations` lookup: a retry of this `client_op_id` returns **the same receipt**, no new sequence.
2. Recompute the closure; if the hash differs: `scope_changed`; any dependent without a decision: `unresolved_dependents`.
3. `ErasureControl.addErased(all record ids and all root ids that will be stubbed)`; if it fails return `erasure_list_unavailable`
   and change nothing in the data store (the fence is the already-added ids; a retry completes the same erase).
4. Compute source tokens (bytes and identities) **before** wiping any source.
5. One `transactionSync`: insert the erase `operations` row (`operation_kind='erase'`, `retry_policy='sealed'`,
   `erasure_manifest` per below, `blocked_source_tokens` JSON array, `erasure_state='local_pending'`, `backup_state='expiry_pending'`),
   release current markers of every selected revision, defer the triple FK, replace each selected payload with its all-NULL
   stub (`is_current=0`, `is_erased=1`, **every other column NULL**, in the table named by `records.kind`), sanitize each selected
   `records` row to the envelope allowlist (kind NULL, `change_kind='erased'`, `erasure_op_seq=E`, times, actors, reasons and
   `supersedes_id` cleared, `root_id` kept), seal affected operations (`retry_policy='sealed'`, digest and `ingested_at` NULL), verify
   foreign keys, exactly-one-payload-or-stub, scope completeness, then commit.
6. After commit: `sealOperations(affected + E)`, `addSourceTokens`, delete artifacts through `ArtifactEraser`
   (`sources.artifact_uri` captured **before** the wipe), purge caches and any derived structures, then set
   `erasure_state='local_verified'` only when every step succeeded (otherwise `failed`, with the fence still in force).
**Manifest JSON** (`operations.erasure_manifest`): `{ "record_ids": [], "root_ids": [], "affected_operation_seqs": [],
"dependent_decisions": [{ "root_id": "", "action": "erase" }], "artifact_ids": [] }`: exactly one `{ root_id, action }` per dependent root; opaque ids and action codes only; `artifact_ids`
are random ids you assign per artifact, never URIs. The Ledger stores pending `{ artifact_id, uri, client_op_id }` deletions internally in the same transaction as the stubs and removes each row only after confirmed deletion. This table is excluded from export, feed, restore, receipts, and replies so a post-restart retry can resume without putting a URI in the manifest.
**`LedgerDO.eraseStatus(route, { client_op_id })`** returns the `EraseReceipt` (`erasure-types.ts`) with current states. Receipts and
every error for erase contain nothing else.
A target or dependent that is already an erased stub returns its existing safe receipt and accepts no new operation. A stub id can
never be written, restored, revised or referenced again (guard in section 1).
**Retained dependents** (`retain_nonrevealing`): stay as they are; evidence rules treat an erased source as "evidence unavailable".
Rules `P02`, `E01`, `E02` and the views already understand stubs; run them after every erase in tests (`auditAll` must stay clean
except for violations the spec explicitly allows for retained dependents; record any you find).

## 3. Change feed (`feed3c`)
Implements the "Change feed" and "Feed replacement for erased mutable history" sections exactly.
**`LedgerDO.feedOperations(route, { after, limit?, incarnation? })`** → `{ ok: true, incarnation, high_water, operations: [{ op_seq,
client_op_id, operation_kind, retry_policy, ingested_at|null, erasure?: { erasure_state, backup_state, manifest } }], next_after, more }`.
**`LedgerDO.feedRecords(route, { after, kind, limit?, incarnation? })`** → `{ ok: true, incarnation, high_water, changes: [{
change_sequence, id, root_id, kind|null, change_type: 'create'|'correction'|'revision'|'delete'|'restore'|'erased', op_seq,
erasure_op_seq|null }], next_after, more }`, merged and ordered by `(change_sequence, id, change_type)`, with every erasure notice
(`is_erased=1`, `erasure_op_seq` in range) included for **every** kind and carrying no kind.
Cursor rules: `after` is the last `change_sequence` returned and the page never splits an operation (drain a whole operation or
return it whole); a `limit` default 100, maximum 500. A request whose `incarnation` differs from `ErasureControl.incarnation()`
returns `{ ok: false, code: 'resync_required' }` and nothing else; so does any request whose `after` is greater than the current
high-water. `high_water` is captured once per call. Retries, rejections and read-only calls allocate nothing and never appear.
Reads obey the erasure barrier first: ids in the erasure list never return content. Never return a request digest.

## 4. Export (`export3d`)
`BACKUPS` is an `R2Bucket` binding (faked in tests). Key layout: `exports/<physicalStoreId>/<exportId>/manifest.json` and
`.../<table>/<nnnnnn>.ndjson`. Rules:
- `LedgerDO.exportStart(route, { exportId })` fences writes (`store_busy` for writes, reads continue) and records the snapshot
  position (`high_water`, ErasureControl incarnation and floor, schema version and migration checksums); it fails closed if ErasureControl is unavailable. `exportStep(route, { exportId, cursor })` writes
  **one bounded chunk** (at most 1 MiB or 5,000 rows; never the whole database in memory) of table rows in a deterministic keyset
  order, returns the next cursor; the last step writes the manifest and lifts the fence. A fence that is not completed within 5
  minutes lifts itself and marks the export `aborted`.
- The manifest lists every table with row counts and every chunk with its SHA-256 and byte size, plus `created_at`, `expires_at`
  = created + **30 days** (hard maximum), the incarnation, the sequence floor, and an HMAC signature (domain `nova.export.v1`).
  Erased stubs are exported as stubs. No erasure list, secrets or operation request digests are exported.
- `exportScrub(route, { recordIds })` (urgent scrub, only on request): deletes **every** export object/version/manifest/chunk
  that covers any of the ids (find them via a per-export id index you write at export time, containing only ids and chunk names),
  reports what was deleted, then runs a fresh clean export. A failed deletion is a visible failure, never "verified".
- `purgeExpired()` deletes exports past `expires_at`; restore refuses an expired export. (A real R2 lifecycle rule is added by
  Claude at deploy; this code is the second line of defence.)

## 5. Restore (`restore3d`)
Implements "Quarantined restore protocol" steps 1 to 7.
- **Control** gains migration v4 with a `quarantine_stores(physical_id PK, source_logical TEXT, state TEXT, created_at, export_id)`
  table (the existing `store_map` only allows `real` and `sandbox`, so a quarantined store is **not** in `store_map` until activation).
- `restoreBegin({ exportId, targetLogical })` accepts the signed export manifest and chunk shape directly, creates a new physical Ledger id, loads the verified chunks into it with all
  reads, exports, imports and tools disabled for that store, **never trusting the export for control state**.
- It then fetches one **current** `restoreSnapshot()` of erased IDs, sealed operation IDs, source tokens, floor and incarnation from `ErasureControl`, matches
  restored records by `id in list OR root_id in list`, expands to all revisions, applies the stub transform and dependent
  rules from section 2 (a newly discovered revealing dependent blocks release for per-record review), allocates a fresh replay erase
  operation above the sequence floor when the original is absent, carries sealed operation IDs and tokens forward, raises the
  `sqlite_sequence` for `operations` to the floor, imports the snapshot into the destination ErasureDO, allocates its **new incarnation**,
  stores the same incarnation in the restored Ledger, and runs `auditAll`, `foreign_key_check` and the
  schema checksum comparison. Output is a report of counts and codes only.
- `restoreActivate({ restoreId })` refuses unless every check passed; it swaps `store_map(targetLogical)` to the new physical id,
  increments `generation` (invalidating handles), marks the old store retired, and leaves the old data store untouched for the
  operator to delete. Never activate into an existing logical name automatically without the explicit call.
- A quarantined physical id is absent from `store_map`; tool routing resolves only the currently mapped store until explicit activation.

## 6. Drill (`drill3d`)
`src/drill/` implements the numbered steps of `docs/schema/DELETION_DRILL.md` as code over the interfaces above
(`runDrill({ ledger, erasure, backups, clock })` returns a report `{ steps: [{ n, name, status: 'pass'|'fail'|'not_run', detail_code }],
summary }` with **no canaries, content or secrets**). Steps that need real Cloudflare behavior (built-in point-in-time recovery
bounds, R2 lifecycle expiry, provider logs) are `not_run` locally and listed as such: the report must never claim them. A
**clock abstraction** lets tests move time forward 31 days to prove expiry and purge. The sandbox-only operator route
(`/__drill`, owner OAuth bearer, `NOVA_STORE_MODE=sandbox`, `NOVA_DRILL_ENABLED=true`, never in `real` mode) runs the drill on the
deployed Worker; it exists only as a thin handler that Claude wires at deploy.

## Gate for 3c and 3d
All lanes' tests pass in workerd (typecheck, lint, unit, workers, DB, browser: `npm run check`); the local drill passes steps 1 to
14 and 16, marks real-infrastructure steps `not_run` honestly, and the canary strings never appear anywhere a reader can reach.
Real-Cloudflare steps (PITR bound, R2 lifecycle, deployed restore) are run by Claude after the first deploy; step 15 (30 days) is
monitored (decision recorded in `docs/LAYER3_PLAN.md`).
