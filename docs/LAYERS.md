# NOVA build layers

Agreed 2026-11-04. Each layer is built across **all rooms** before the next one starts,
and each is gated by a test. A layer may depend only on layers below it. If a room needs
private plumbing to work, the layer below it is wrong; fix that layer, not the room.

Why this order: Fitness was built top to bottom (write path, tools, widget) before the
schema and cross-room links existed for the other rooms, and Fitness's shape leaked into
the shell and tools. This replaces that approach. Governing docs remain
`NOVA_FOUNDATION.md`, then `NOVA_TECHNICAL_DESIGN_1.5.md`.

| # | Layer | What it is | Gate (must pass before the next layer) |
| --- | --- | --- | --- |
| 1 | Schema | Tables, columns, keys, time/money/unit rules for every room. Spec docs first (`docs/schema/`), derived from the Foundation. | Every room's "questions the schema must answer" list is answered from its tables; Claude's diff against Technical Design section 6 reviewed. |
| 2 | Relationships | Cross-room links and the shared parts every room uses: ownership, references, provenance, event history, correction lineage, entity refs. | Every cross-room link the Foundation names has a defined owner and reference mechanism (`CROSS_ROOM.md`); no room defines its own link or history plumbing. |
| 3 | Write path | One operation registry for all writes: idempotent `client_op_id`, receipts, corrections, duplicate handling, stale-revision rejection, real/sandbox split, attribution. | Real SQLite tests per room; a retry never double-writes; a correction keeps lineage; nothing falls back to the real store. |
| 4 | Read path | Views and derived data (streaks, trends, coverage, rollups, Overview), computed from layers 1 to 3, never stored as facts. | Each derived value is reproducible from raw rows; unknown is never shown as "missed". |
| 5 | Artifact contract | The tools Claude and artifact pages call: read tools that return structured JSON, standalone (no `nova.open` needed), thin wrappers over layers 3 and 4, plus a style guide for building pages. | One artifact per room built from the contract alone, reading JSON and writing through layer 3, with nothing room-specific added to the server. |
| 6 | Shell and widget | Thin pre-built widget only where a provable human tap matters (confirms, homepage, anything an artifact cannot prove). Everything else is a Claude-built artifact. | Confirm flows work on devices; homepage stays logo plus room selector. |
| 7 | Intelligence | Associative patterns, second voice, proposals, mandates. Needs real history underneath. | Defined when layers 1 to 6 hold real data. |
| 8 | Integrations | Spotify/Last.fm, OCR for Relationships, calendar import, Health. Plug in at layer 3. | Per integration; each writes only through the layer 3 registry. |

## Standing rules
- **Artifacts are untrusted callers.** The host does not stop a page from calling write
  tools or app-only tools (observed on Windows and iPad; see `docs/ROADMAP.md`). The
  server enforces every rule itself; the host's read/write label is not a boundary.
- **Keep layers 1 to 5 host-neutral.** Artifact connector access is Anthropic's feature
  and can change; a different front end must be able to replace it.
- **Backup and restore must exist before any real data**, especially finances, mind and
  memory. Heavy consent and freeze design waits until sensitive data goes in.
- **Gates are tests, not opinions.** A layer is done when its gate passes, not when it
  looks finished. Device results stay "pending" until Lucas shows them.

## Status
| Layer | State |
| --- | --- |
| 1 Schema spec | Done on `schema/layer1` (6038650): 11 room specs, shared conventions, cross-room doc, erasure decision (tombstone, 30-day backups, quarantined replay) and deletion drill. Local only, not pushed. |
| 1b Schema DDL | Done. Branch `ddl/base` (tag `layer1-closed`, 015ece5): shared DDL, 11 room files, 112 tables, 603 FKs, 33 partial unique indexes, checker passes all rooms (123 items still manual review), 80 tests. Spec decisions closed 2026-11-04: Body targets stay nonnegative, Focus `confirmation_source_id` added, Inventory edible kind deferred. Local only, not pushed. |
| 2 Relationships (integrity rules) | Done 2026-11-05. `ddl/base` tag `layer2-closed` (5d889c7): 46 violation-query rules (groups L, P, R, N, K, G, M, S, U, H, F, I, C, X, E), runner with `checkOperation` and `auditAll`, two triggers, 110 fixture builders, 251 tests. Verified: clean-store audit 0, correction-neutral audit 0, every rule mutation-killed, DO SQLite capabilities proven in workerd. Plan: `docs/LAYER2_PLAN.md`. |
| 3 Write path | **3a done** (112-table schema in the Ledger Durable Object, rules and triggers, Fitness retired; tag layer3a). **3b done** 2026-11-05 (operation registry: idempotent HMAC retries, atomic multi-record writes, descriptors and validation for 110 tables, rules in the transaction; `docs/layer3/3B_CONTRACT.md`; tag layer3b-merged). 3c (erase, ErasureDO, change feed) and 3d (backup, restore, deletion drill) not started. |
| 4 Read path | **Done** 2026-11-05. 80 named parameterized queries across all rooms with coverage columns, pinned-reference resolution, Sunday weeks, correction-neutral sweep, mutation-checked, proven on real Durable Object SQLite (tag layer4-closed). Open limits: OVR-02 cannot place attribution-date-only records from UTC bounds alone; HIS-01 and HIS-02 return envelope data, not full typed payload diffs; Mind support links hit a record_links relation CHECK mismatch (see db/findings/views-viewsa.md). |
| 5 to 8 | Not started (device test kit and research findings are ready for layer 5; integrations feasibility notes written) |

## Open items carried from earlier work
- Untested: iPhone artifacts with connector, consent prompt on every reload, page-originated
  calls against Pro usage, Ink stroke storage tool.
- Existing Fitness code (`src/ledger/`, `src/operations/`, widget) predates this plan. **Decision
  2026-11-04: retire it, do not port it.** Fitness is rebuilt through the new write path (layer 3)
  onto `body_workouts` and `body_workout_sets`.
- **Cloudflare:** Lucas is on the paid plan and authorized the build to create and manage the
  Cloudflare resources it needs (R2, Durable Objects, secrets, deploys). He signs in himself;
  nothing real enters a store before the deletion drill passes.
