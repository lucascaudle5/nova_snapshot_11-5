# Shared schema conventions

Authority: `NOVA_FOUNDATION.md` only for the first drafts. Technical defaults below are proposals where the Foundation does not specify implementation; see [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md). These are specifications, not migrations. Citations use room names without the `NOVA` prefix. Subsection citations disambiguate repeated numbering in Focus and the general Foundation sections.

## Store, types, and ownership

- One SQLite database per store; proposed store boundary is this single owner's entire NOVA, containing all eleven room namespaces and the shared tables below. No `user_id`, tenant, household, membership, or organization columns. Overview owns no tables, preferences, caches, or snapshots; it reads room facts and computed projections (Overview #1–9).
- `TEXT`, `INTEGER`, `REAL`, and `BLOB` are SQLite storage types. Use strict type validation. `NN` means physical NOT NULL; `NN live` means physically nullable but required on a non-erased row; `NULL` means nullable live. Every domain column is NULL erased under the uniform rule below. Empty text is not an unknown value. JSON is validated TEXT with the shape specified at its column.
- Record IDs and client_op_id are lowercase UUIDv4 strings, generated before writing, independent of event chronology. Every domain and shared-content table has `id TEXT NN`, a primary key and foreign key to `records.id`, plus `is_current INTEGER NN` and `is_erased INTEGER NN` mirrors. All three columns are explicitly included in every payload definition. Infrastructure tables `records` and `operations` are exceptions described below; operations uses an integer sequence PK and a unique UUID operation identity.
- Every FK is restrictive on physical deletion; no cascading loss of historical evidence. Domain FKs target a specific typed revision. Metadata, observations, original sources, and history remain inspectable (Memory and continuity #1–6, #10). The room prefix identifies ownership, not a separate database.
- A non-erased records.kind names exactly one typed table; every record has exactly one corresponding same-id payload. Soft-delete tombstones copy content; hard-erased envelopes clear kind and retain exactly one same-id NULL-domain stub in the original table. This discriminator exception and exactly-one invariant require commit validation. Room FKs target the named table's id unless stated otherwise.

## Four distinct time concepts

| Concept | Representation and rule |
|---|---|
| Event time | `records.event_start_at`, `event_end_at`: when the described event happened or a definition became effective. UTC RFC3339 text with fixed millisecond precision. Unknown instants remain NULL. Planned instants live in explicit plan columns, not these actual-event fields. |
| Report time | `reported_at`: when the user, another person, or upstream source made the assertion. Can precede ingestion by years. Unknown remains NULL. |
| Ingestion time | `ingested_at`: when NOVA accepted this revision. Required UTC timestamp; never substituted for event or report time. |
| Attribution date | `attribution_date`: explicit local YYYY-MM-DD used for daily accounting, with `time_zone` and `attribution_basis`. Can be known when exact event time is unknown. Sleep can belong to its wake date and a late habit to the intended prior day without rewriting its event time. |

`time_precision` is `instant`, `interval`, `date`, `approximate`, or `unknown`. Date-only inputs do not fabricate midnight events. `event_end_at >= event_start_at` when both exist. Attribution is either user-selected, source-supplied, derived from a known event using a documented room policy, or unknown. Derived attribution is bookkeeping, not an inferred behavioral fact. `attribution_date` requires an IANA `time_zone` and non-unknown basis; unknown timezone leaves daily attribution unresolved. Recurrences use local wall time and an IANA zone. DST ambiguity must be resolved explicitly; see OPEN_QUESTIONS. Planned intervals are half-open `[start,end)`; adjacent blocks need not conflict. Unknown dates do not appear as today's events by default.

## Units and unknown values

- Money: signed integer cents with uppercase three-letter currency on every amount-bearing row. Cents means 1/100 of the named currency under the proposed initial currency support; non-two-decimal currencies require a decision before use. Never REAL money, implicit currency conversion, or cross-currency summation. Exchange valuations are explicit reported balances or scenario assumptions, not silently applied rates.
- Mass and weight use grams; distance, height, circumference and other lengths use meters; duration uses integer seconds. Fractional grams/meters may use REAL where declared. Counts use INTEGER. Nonnegative checks apply to quantities unless an explicitly signed change is specified. Temperature, nutrition, and clinical measures carry explicit units; no guessed conversions.
- NULL means unknown/not supplied; it does not mean zero, false, absent, failed, skipped, or missed. An unlogged habit, meal, medication dose, workout, assignment, or focus session is **unknown**, even after its planned time passes. `missed` is only an explicit report/confirmed conclusion with evidence and attribution, never the complement of completion. Dashboards distinguish planned, reported complete, explicitly not done, and unreported. Coverage and streaks are computed with unknown gaps visible.

## Provenance, corrections, and derived information

- `asserted_by` records who said it (`user`, `model`, `automation`, `other_person`, `external_source`); `captured_by` records who entered/extracted it (`user`, `model`, `automation`). A model organizing the user's words does not become the speaker. Another person's identity is a `speaker` record link to Relationships; an OCR transcription is an automated observation linked to the original image, not a user statement.
- Every non-erased substantive record has at least one `record_sources` row, including a retained voice/text report or explicit manual-entry source. Preserve original wording/media separately from extraction. Derived claims must have evidence links. Domain fact tables admit reported/observed/adopted plans, not model guesses. `annotations` holds hypotheses, interpretations, recommendations, questions, decisions, and feedback separately. Model-generated practice content is proposed instructional material, not an observed outcome.
- Streaks, totals, trends, balances calculated from transactions, progress percentages, summaries and inferred patterns are computed views. No persisted daily score, calculated balance, materialized summary, profile synthesis, or opaque prediction table. Explicitly retained interpretations and adopted choices are authored records in `annotations`/`record_links` with evidence, status and uncertainty (Memory and continuity #2, #5, #12; Associative Intelligence / Connections and understanding #5–8).
- Correction appends immutable content: allocate a new revision ID, retain the same `root_id`, set `supersedes_id`, and give `change_kind`/`change_reason`. A correction repairs an erroneous account; a revision records a changed definition, goal, intention or perspective. Old facts and sources remain unless explicitly hard-erased. All content columns are copied or deliberately revised atomically. Outside hard erasure, the sole routine in-place update is the mechanical `is_current` release on an older envelope and its payload mirror, specified below; it is not a correction of that revision's content.
- Soft delete appends a successor with deleted_at set and hides a lineage while retaining history; restore appends another non-erased successor. Hard erasure is the adopted irreversible all-revision stub design below, never a soft-delete restore. Backups now follow Lucas's separate adopted retention/restore decisions; no facility or passed drill is implied.
- `current_records` selects envelopes with `is_current=1`. `as_known_at(t)` first checks the erasure barrier and otherwise reconstructs terminal revisions as of accepted operation sequence/ingestion history, ignoring today's current marker; `as_effective_at(t)` additionally follows event/effective times of deliberate revisions. Corrections invalidate the superseded account in present understanding; deliberate revisions preserve what was intended then. A domain FK pins a revision so the habit standard, plan, or source used at that time remains known. For current navigation, resolve its `root_id` to the terminal revision, exposing deletion instead of silently dropping the link. Historical queries never mix revisions or count both as separate events. Child snapshots are selected under the chosen parent revision; a child's marker does not assert that its parent definition is today's adopted definition.
- `root_id` points to the first revision (self for originals); `supersedes_id` stays in the same kind/root and is unique when non-NULL. No ordinary branching, cycles or in-place content mutation; adopted hard erasure clears content/adjacency destructively. A non-erased original has no predecessor; each later ordinary revision has one. Erased rows use the explicit cleared-predecessor exception. All revision/correction changes carry source evidence. Re-parenting and logical duplicate merging use an explicit `same_as` link with supporting evidence; they do not erase records.

## Enforceable current revisions and partial unique indexes

`records.is_current` is INTEGER constrained to 0 or 1. It is 1 **only** on a lineage's sole terminal non-deleted, non-erased revision. A proposed, retired, cancelled or disputed domain record can still be its lineage's current revision: this flag describes revision position, not adoption, success, endorsement or presence in today's calendar. A deleted lineage has zero current revisions and a terminal tombstone with flag 0.

| Accepted operation | Old terminal envelope and mirror | New envelope and mirror | Required atomic order |
|---|---|---|---|
| Original | None | 1 | Create operation, envelope, payload and evidence. |
| Correction | 1 → 0 | 1 | Check live terminal predecessor; release old marker first, then append correction/evidence. |
| Deliberate revision | 1 → 0 | 1 | Same order; retain original purpose/plan and reason for changed intention. |
| Soft delete | 1 → 0 | 0 | Release old marker, append tombstone copying content with deleted_at set. |
| Restore | Terminal tombstone stays 0 | 1 | Verify tombstone predecessor, append restored content; never reactivate an old row. |
| Hard erasure | Every selected revision becomes current=0/erased=1 | No new revision copy | One erase operation sanitizes every member/stub and emits erasure_op_seq; restore forbidden. |

The marker flips, all cascaded mirrors, new revision, sources, links and accepted operation commit in **one transaction**. Failure rolls back every flip and insert. A stale predecessor/second concurrent successor rejects the write. Release all superseded markers before inserting replacement keys in a multi-record operation: SQLite unique indexes are immediate, even when FKs are deferred. A retry does none of these steps again. Correction/revision/delete require a live terminal; a non-erased soft tombstone can be followed only by restore; erased roots reject ordinary successors. All older revisions remain 0.

An ordinary SQLite partial index cannot inspect a joined envelope. Therefore every payload has a physical `is_current INTEGER NN` constrained to 0/1 and a composite FK `(id,is_current,is_erased)` → `records(id,is_current,is_erased)` with **ON UPDATE CASCADE** and a deferrable constraint, restrictive deletion. The parent has full UNIQUE `(id,is_current,is_erased)`. Flipping the envelope cascades to its existing payload; the FK forbids an independently divergent mirror. FK enforcement must be enabled. This is deliberate mechanical duplication, not an inferred life fact. `records` has UNIQUE `(root_id) WHERE is_current=1` and CHECK that a tombstone has is_current=0. These indexes enforce **at most** one live current row; they cannot prove that the right terminal is marked or that a live lineage has one at all. See the remaining invariants below. [SQLite partial indexes](https://www.sqlite.org/partialindex.html), [composite FKs and cascade actions](https://www.sqlite.org/foreignkeys.html).

Room constraints spell out each partial UNIQUE key and predicate on that table's mirror. They are real single-table indexes; no predicate hides a JOIN/subquery. Nullable-parent names use two indexes (non-NULL parent plus parentless name), since NULLs do not conflict in SQLite UNIQUE. Series/obligation uniqueness across revisions uses explicitly stored root IDs, with composite FKs validating those mirrors against records(id,root_id). Index columns mean exact revision IDs unless explicitly named root IDs. Current marker changes may free/reclaim a domain key, but historical records and pinned references remain.

## Change feed: one sequence per accepted operation

Foundation: Memory and continuity #1, #3, #6, #9; Overview #4, #8; Initiative and action #9. Sequence allocation and read protocol are technical defaults requested for this revision.

`operations.op_seq` is a positive per-store monotonically increasing INTEGER PRIMARY KEY using SQLite AUTOINCREMENT semantics. `client_op_id` remains unique. Assign the sequence in the same serialized write transaction that accepts the operation; let SQLite allocate it, never client-side `MAX+1`. Gaps are permitted, reuse of committed sequences is forbidden, exhaustion fails the write. SQLite's internal allocator is bookkeeping, not a new NOVA fact table. Every newly created records row carries exactly that operation's `op_seq`, including sources, association revisions and tombstones; it is **not** independently incremented per row. A full UNIQUE `(client_op_id,op_seq)` on operations and a composite FK from records enforce the association. No payload copies, global events table, extra fact table or mutable change timestamp are introduced. [SQLite allocation semantics](https://www.sqlite.org/autoinc.html).

- **Operations since N:** capture committed high-water H (0 empty), select `N < op_seq <= H` ascending, paginate by last returned sequence. Include erase receipts; retries/rejections/read-only calls allocate nothing. Open-write digest conflicts reject; sealed operations return only safe closed receipts.
- **Ordinary records since N by kind K:** select non-erased rows with `N < op_seq <= H AND kind=K`, ascending `(op_seq,id)`, including superseded and soft-deleted revisions. Drain full operations or use a full cursor; all kind subscriptions share H. **Also merge every erasure notice by erasure_op_seq regardless of K**, exactly as specified under Erase operation below. Creation content is ordinarily immutable, but hard erasure overrides old snapshots/history.
- Correction/revision emits a successor; soft delete emits a terminal tombstone; soft restore emits a non-erased live successor. Clients invalidate prior revisions by root/supersedes. Hard erasure mutates all selected revisions to stubs and uses its separate accepted erasure sequence, never a copied successor. Deduplicate by `(change_sequence,id,change_type)` so later erasure of an existing ID cannot be lost.
- Store rewind/unsafe cursors require resync, independent erasure replay in quarantine and a new opaque history incarnation under the adopted backup protocol. Current-state browsing uses the flags; historical/feed reads obey the erasure barrier first. No old H authorizes a post-erasure secret response. No backup/restore facility or gate success is claimed.

## Reported barriers and social context

Research checklist is a coverage prompt, not evidence about Lucas or a source of thresholds/automatic diagnoses. Its population findings/numbers are not adopted as facts. Foundation support and owning fields are cited in the rooms.

`reason_code`/`reason_text` are optional reports on explicit nonperformance. Proposed vocabulary: `time`, `pain_or_health`, `energy_or_mood`, `competing_obligation`, `environment_or_resources`, `changed_intention`, `other`. Text requires a code (`other` is available); code may stand alone. Both must be NULL for unknown and all statuses not explicitly allowed by the table. A not-done report may have no reported reason. Never infer motivation, pain, avoidance or a cause from the miss. Habits/routine/schedule/workout nonperformance is not_done, Meals is not_eaten; Focus allows not_done (never began) and abandoned (reported stop after beginning).

Activities may have optional `social_context`: `alone`, `with_people`, `group`, `supervised`, `supervised_group`; NULL means not reported. Named people are activity → person `involves_person` links, with `participant_role` on the link (`participant`, `supervisor`, `collaborator`, `group_member`). No fictitious "alone" person, inferred roster or required identity for an unnamed group/supervisor. This single activity column is necessary because alone or an unnamed group has no person endpoint to link. Alone forbids adopted current involves_person links; NULL is compatible with a named-person report before a setting classification is given. Setting/roster consistency requires a cross-record check. Workout sets inherit their workout's context without copying it. Pain/discomfort remains reported text; reported_health_context links to Body symptom/injury records represent only the user's stated relationship, never a model diagnosis or causal finding.

## Hard erasure adopted: erase content, retain opaque tombstones

**Adopted by Lucas, 2026-11-04: option 1.** This closes the erasure-shape decision. The 30-day backup/restore choices are also adopted below; **nothing real enters until backup, restore and the layer 3 deletion drill pass**. These are specifications, not an implementation or a passed gate.

Hard erasure sanitizes **every revision of each approved lineage**, including originals, corrections, superseded definitions, soft-delete payload copies and restored copies. It is an explicitly authorized destructive exception to ordinary immutable content, not another secret-bearing revision. Soft delete remains reversible hiding; an erased root can never be corrected, restored, appended to or reused. Readers return `ERASED`/unavailable, distinct from unknown, missed, not found or merely soft-deleted.

### Erased envelope allowlist

This table covers every records column. No unlisted value survives. Future envelope fields need an erasure rule before use. Cleared means SQL NULL: no guessed actor, coarsened event date, empty-string secret or original metadata copy. No exact erased_at timestamp is kept; the flag and erasure sequence supply minimum state/order.

| Column(s) | Erased state | Reason |
|---|---|---|
| id, root_id | Keep opaque UUIDs; original root remains self-rooted | Stable incoming references, whole-lineage barrier and refusal to restore. Root membership survives, not content. |
| op_seq | Keep original creation sequence; direct FK to operations | Opaque ordering and original operation result membership; never repurpose a sequence. |
| is_current | 0 on all revisions | Exclude from live reads and every current partial unique key. |
| is_erased | 1 | Irreversible content-erased state. |
| erasure_op_seq | FK to accepted erase operation's op_seq | Notify clients/replay erasure on restore without exact times or identity. Set once; replay preserves it. |
| change_kind | Constant `erased` | Minimum state; original action kinds do not survive. |
| kind | NULL | Remove room/type classification from public envelopes/feed notices. A typed stub remains only for FK continuity. |
| supersedes_id | NULL throughout the erased root | Remove detailed correction/action adjacency; root membership suffices. Ordinary predecessor checks explicitly exclude erased envelopes. |
| change_reason | NULL | Free text may identify the subject or circumstances. |
| event_start_at, event_end_at, reported_at, ingested_at, deleted_at | NULL | Exact or coarsened per-record time could reveal an episode, conversation or action; none is needed for erasure. |
| attribution_date, time_zone, time_precision, attribution_basis | NULL | Dates/locations/precision can be sensitive; erased is not a fabricated unknown measurement. |
| asserted_by, captured_by | NULL | Remove speaker/actor and capture-route information. |
| client_op_id | NULL on erased records | Per-record request correlation unnecessary; opaque operation identity survives only in operations, resolved through original op_seq. |

Opaque IDs/sequences/inbound FKs remain pseudonymous structure, not guaranteed anonymity. A privileged raw DB reader can infer a former table from a typed stub or retained inbound FK. Public APIs return only unavailable handles; concealing all physical table/graph membership would require a different storage design, not a claim made here.

### Uniform payload-stub rule

Every payload, including sources, record_sources, annotations and record_links, keeps physical **id TEXT NN**, **is_current INTEGER NN** and **is_erased INTEGER NN**. Flags are 0/1. Its composite state FK is `(id,is_current,is_erased)` → records(id,is_current,is_erased), **ON UPDATE CASCADE, DEFERRABLE INITIALLY DEFERRED**; keep the ordinary id FK. records has the full UNIQUE triple. FK enforcement remains enabled.

An erased payload is a **same-table minimal stub**, not removed or replaced by invented values: id unchanged, is_current=0, is_erased=1, **every other column SQL NULL**. This includes descriptions, dates, names, amounts, statuses, order, external IDs, source text/extraction/URI, participant details, root mirrors and outgoing FKs. Incoming FKs still find the same id. Original source bytes and all recoverable copies are separately scrubbed; clearing a URI alone is insufficient.

One general two-state constraint rule applies to every payload:

- Only id and the two flags remain physically NOT NULL. **NN live** means physically nullable, explicitly required IS NOT NULL when is_erased=0, and required NULL when is_erased=1. Originally nullable domain columns also must be NULL when erased.
- A row CHECK permits either live state (is_erased=0, all NN-live requirements, original row CHECKs) or erased state (is_erased=1, is_current=0, **every** domain field IS NULL). Explicit IS NOT NULL tests matter: SQLite treats a NULL CHECK result as passing. Cross-row live semantics recognize an erased target as unavailable rather than guessing its type/scale/currency. There are no eleven separate sentinel vocabularies.
- PKs, flag checks and FKs always apply. Existing current partial indexes remain real indexes; erased rows have is_current=0 and are excluded. Outgoing stub FKs become NULL; incoming id FKs remain valid.
- **Exactly one typed payload still exists per record.** Live kind selects its table. Erased kind is NULL: the precise discriminator exception is one all-NULL-domain same-id stub in the original typed table, checked across payload tables at commit. There is no missing payload/new erasure fact table. Required source evidence, actors/times and ordinary predecessor/discriminator constraints apply only to non-erased envelopes.

Transaction order: allocate the erase operation; release all selected live current markers; defer the triple FK; replace each selected payload with its complete NULL-domain/is_erased=1 stub in one update; sanitize its envelope to this allowlist and erasure_op_seq; sanitize affected operation metadata; validate FKs, complete lineage scope and exactly-one-stub before commit. The temporary state-FK mismatch is allowed only inside that transaction. Row CHECKs hold after every row update. Failure rolls back all local flips/stubs. External bytes, SQLite free pages/WAL and copies must also be sanitized before claiming local completion.

Each root_id still points at an erased root stub; supersedes_id is cleared for every member. is_erased takes precedence over as-known/as-effective/historical queries: no old content or chain is reconstructed. Existing safe references can retain an unavailable id; new writes cannot fill a stub or revive its root. Unrelated live facts retain all their normal checks.

### Operations and digest privacy

Retain operations.op_seq and validated random UUIDv4 client_op_id; no content-derived IDs or natural keys. On an operation affected by approved erasure, clear **request_digest and ingested_at**, including any historical receipt/error copies. Exact operation times and even bare hashes of low-entropy text can reveal erased information. A mixed operation with some retained results is sealed as a whole for replay safety.

Add retry_policy=`open` or `sealed`. Open ordinary writes use a versioned, domain-separated **HMAC-SHA-256** digest with an independent random per-store verifier secret outside the database and its ordinary data backups. Bare SHA-256 is not a safe private fingerprint for guessable content; old bare digests must be erased. Sealed operations have NULL digest/time. Any reuse of their client_op_id returns only an opaque already-erased/erase receipt, never executes or enlarges the request, even if a different body is supplied. The erase operation itself is sealed immediately; its opaque sequence/manifest permit retry without retaining its request hash/time.

A key holder or exposed comparison oracle could still test HMAC guesses: tokens are not proof of anonymity. Keep keys separate, expose no lookup oracle, restrict ingestion/retry checks and clear any token known to leak identifying content. Key isolation/recovery/rotation and backup enforcement must satisfy the adopted contract and be proved by implementation/drill evidence. [HMAC construction](https://www.rfc-editor.org/rfc/rfc2104), [SQLite CHECK semantics](https://www.sqlite.org/lang_createtable.html), [deferred composite FKs](https://www.sqlite.org/foreignkeys.html).

### Dependents: one explicit review list, no silent redaction

Planning enumerates all revisions of the target root plus source/extraction/artifact aliases, incoming and outgoing FKs, annotations, links, cached/derived copies and affected operations. NOVA may suggest candidates but **Lucas decides**, separately for every listed dependent: `erase` (entire dependent lineage to stubs) or `retain_nonrevealing` after inspection. Default is **flag for review and block acceptance**. An unresolved, omitted or changed dependent prevents commit; never interpret silence as approval or let a model declare quoted content safe. The reviewed plan binds exact revision IDs and a consistent store snapshot; a changed source/edge invalidates the affected approvals and requires a fresh review before writes.

The narrow evidence-existence exception for a retained live dependent is explicit: a `retain_nonrevealing` decision in the accepted manifest may leave its only evidence source or association erased. A safe retained citation can point to a source stub; if the association itself was revealing and is stubbed, no new live association is invented. The reader displays evidence unavailable and the manifest's approved record ID justifies the missing-source exception. This does not exempt unrelated new live facts from source requirements or endorse the retained claim as newly evidenced.

Review can display the current content to Lucas for a decision, but no quote-bearing plan, approval transcript, log or historical receipt is retained as a new secret copy. Persist only opaque IDs/action codes after acceptance. For selective redaction, erase all original revisions, then create a separately approved non-revealing replacement under a **new root** with independent sanitized source; never retain the old quote in its history or refill the old stub. Erasure of an already explicitly selected target lineage is not optional per revision. The table below is the sole dependency disposition policy.

Artifact deletion uses an internal `pending_artifacts` Ledger table containing only an opaque artifact ID, its URI, the erase operation ID and creation time. Rows are inserted in the same transaction as the stubs and are removed only after the artifact adapter confirms deletion. The table is never included in an export, feed, restore input, receipt or reply; it exists only to let a retry finish after a Durable Object restart.

| Dependent | Required disposition and confirmation | Surviving reference / behavior |
|---|---|---|
| sources and original artifacts | Erase original bytes, original_text, extracted_text, URI/filename/provider identifiers, child excerpts/OCR/transcripts, previews and all secret-bearing revisions/aliases. List each affected source lineage/artifact for confirmation; clearing a DB pointer alone does not erase bytes. | Same-id source stub only. Existing citation resolves **evidence unavailable**, never a fictitious title, blank source presented as evidence, or reconstructed text. |
| Shared sources used by several records | List **every** consumer before acceptance. Original shared bytes containing the target are erased in full; shared use is never a reason to retain the secret. Lucas confirms source erasure and each dependent's erase/nonrevealing-retain decision. A sanitized excerpt for unrelated content is a separately approved new source/root, not a preserved original copy. | Safe consumers may keep old source IDs showing evidence unavailable, or separately cite the new sanitized material after explicit revision. No automatic relinking to an invented equivalent source. |
| record_sources | Inspect record_id/source_id/role and their revisions. A revealing evidence association is itself erased to a stub after Lucas confirms; a reviewed non-revealing citation row may retain its IDs and role even when the source/subject is erased. Required-evidence validation recognizes unavailable evidence and never manufactures a source. | ID FKs stay valid. An erased citation association loses its outgoing IDs under the universal stub rule; any other citation that still has a source ID displays unavailable. Neither case displays historical erased text. |
| annotations and record_links | List quotes, summaries, implications, interpretations, confidence/status, relation/role labels and even a seemingly harmless association that reveals the target. Each needs Lucas's explicit erase or retain_nonrevealing decision; never silently redact or retain. Erase all revealing versions, not only today's body/rationale. | Confirmed safe rows may keep an unavailable subject/endpoint ID, with unavailable evidence. Revealing rows become stubs and cannot keep a revealing relation/category under the guise of metadata. No generated summary reconstructs the erased subject. |
| Schedule, Finances, Inventory, Body, Habits, Learning, Focus, Music, Workshop and other incoming domain FKs | Keep the referenced opaque ID and let its stub satisfy the existing typed FK. Enumerate the referencing row for review if its purpose/amount/place/date/material/other content can reveal the target; Lucas confirms each disposition. Do not silently delete the referenced ID, cascade-delete another room's fact, or set its value to zero/unknown as if reported. | Query/navigation shows **record unavailable (erased)**; queries requiring its domain/type/scale/currency skip the unavailable contribution and qualify coverage. Unrelated retained rows continue to obey their own CHECKs. Erasure is not a new calendar actual/payment/item disposal. |
| Relationships conversations, participants and other people's messages | A screenshot/thread/source can contain both Lucas's and others' words. Enumerate the entire shared original plus affected messages, participants, profile claims, drafts and commitments across all revisions. Lucas confirms each revealing dependent and collateral loss. Unrelated messages survive only if individually confirmed non-revealing; no inference that another person's words are safe to keep. | Same-id message/person/source stubs preserve safe FKs; display gaps/unavailable evidence, not fabricated senders/text/sequence. Old OCR/media containing erased words is gone even if some unrelated conversation rows survive. |
| Mind reports, episodes, medication/care references and support-plan entries | Enumerate revealing triggers, response text, named support people, appointments, questions, predictions and plan/step revisions, including role links through Relationships. Lucas confirms each dependent. Retaining an unrelated plan is not permission to keep a revealing retired step. | Erased steps/people show unavailable. A plan with missing supporting content is visibly incomplete and cannot drive automatic action; a newly approved replacement plan uses new non-erased material/root where the original root was erased. No memory-based reconstruction. |
| Physical DB copies, search/embedding indexes, caches, logs, receipts and client copies | Inventory secret-bearing copies as deletion scope. No content-bearing error/approval/audit record may become an unreviewed extra copy. Internal indexes/caches are purged/rebuilt; physical SQLite/WAL/free-page cleanup and artifacts need verification. Disconnected clients are notified on reconnect and cannot be remotely certified clean before acknowledgment. | Only safe erase receipt/IDs survive. Completion reports distinguish inaccessible live content, physical local purge, clients awaiting refresh and retained recoverable backup copies; backup expiry/urgent scrub follows the adopted backup policy. |

## Backups and restore — adopted by Lucas, 2026-11-04

The numbered [layer 3 deletion drill](DELETION_DRILL.md) is the gate specification; no drill is claimed complete here.

Section 4 of the updated erasure decision and Lucas's follow-up settle these choices. **These are closed policy decisions. No backup, export, B2 copy, restore implementation or passed drill is asserted to exist.** The policy is: **erased from NOVA immediately, gone from every copy within 30 days.** Immediate means unavailable through NOVA at accepted erasure and verified local cleanup before local completion; a retained backup can still hold recoverable original bytes during its disclosed remaining window. Never label full-copy erasure verified while those copies remain.

| Surface | Adopted retention and erasure behavior |
|---|---|
| Built-in point-in-time recovery | Maximum **30 days**. The design describes DO SQLite's built-in 30-day PITR in technical design §4.1: **from the design, not verified against Cloudflare**. Under this decision, individual records cannot be selectively scrubbed there and may remain recoverable until age-out. Urgent export scrub does not reach it. Layer 3 must verify actual provider bounds before real use; a contradictory/unverifiable bound fails the gate, not silently changes the promise. |
| Managed exports, staged/candidate chunks, object versions and rollback copies | Every content-bearing copy has an enforceable maximum 30-day lifetime from its original recovery point/capture, with no indefinite weekly/monthly archive, hold, old object version or staging exception. Ordinary erase is **expire-only** for export copies: no rewrite of all exports on every erase. They remain inaccessible to live use; restores must quarantine and replay erasure first. Fresh backups are made from clean/fenced current state. Copying or rewrapping an old snapshot never resets its expiry or extends erased content beyond erase+30 days. |
| Urgent scrub extra, only when Lucas requests it | Delete all export objects/versions/manifests/chunks covering the affected record, including in-progress export copies, and create a fresh consistent clean export. Verify deletion/absence rather than retaining a hidden predecessor/version. Removing an entire covering export is acceptable collateral and is reported. This is backup maintenance, not export-before-erase, and cannot selectively scrub built-in PITR. Missing a covering copy or a failed deletion is visible pending/failure, never verified. |
| Off-account/B2 and any other copy | Same 30-day maximum and original-expiry inheritance, including old versions, manual copies and failed-sync leftovers. A copy with no enforced expiry is prohibited. **Mind and Relationships need not wait for B2**; same-account backup/restore/deletion gates still apply, and B2 may be added only with that same enforced limit and its own drill. No B2 facility is claimed here. |
| Known downloaded/exported/client copies and logs | Inventory known copies and apply the same bound where NOVA controls them; prohibit uncontrolled content exports that cannot honor it. Unknown or independently retained outside copies cannot be certified erased. Report that limitation and fail any claimed every-copy verification rather than hiding it. Offline clients must purge on revalidation; no promise of remote recall of already delivered third-party context. |

The 30-day policy explicitly supersedes technical design §18's older six-month weekly-export retention. [Technical design comparison](../../NOVA_TECHNICAL_DESIGN_1.5.md) supplies historical claims, not proof of an installed facility or current Cloudflare behavior. Fresh clean exports made for backup/urgent scrub follow this policy; erasure never creates a pre-erasure archive. Export-before-erase remains only a possible later addition, not adopted.

### Independent ID-only erasure list

**Shape:** canonical UTF-8 set of validated random internal record UUIDs, one per line, no duplicates. It contains every erased revision ID **and each original root ID**, including erased source/dependent roots. It contains **record IDs only**: no reason, actor, room, timestamp, sequence, provider ID, filename, source digest, token, quote, operation ID or per-entry annotations. IDs are pseudonymous handles, not content; do not describe them as mathematically unlinkable.

**Where it lives:** an authenticated, independently durable control resource for this store, outside any domain SQLite snapshot and outside the restore rollback boundary. Keep a separately accessible current authoritative copy; a copy bundled inside an old backup is never authoritative. The implementation must provide durable write-ahead acknowledgment before an erase is accepted and authenticated access during restore; if unavailable, fail closed/quarantine. This is a specified control resource, not an added room fact table or a claim of a deployed service. The current canonical list itself must survive deletion/restore of the data store.

**Retention:** default **keep IDs indefinitely**. Content-bearing backup copies still expire within 30 days; that is not a TTL that clears the authoritative erasure list. Its contentless entries may be considered for removal only after explicit Lucas authorization and proof that **all** older recoverable copies, staging/rollback versions, delayed/offline writes and import paths that could carry the record have expired or are permanently blocked. An age of 30 days alone is not that proof. Never automatically prune IDs while any allowed old backup can contain their record/root. Copies of the catalog can rotate under backup policy, but the current authoritative set must retain its entries.

**Separate suppression/retry control:** sealed operation UUIDs, the opaque committed-sequence high-water/store-history incarnation and keyed source suppression tokens are **not fields of the ID-only list**. Preserve their minimal authenticated control state outside the data-store rollback boundary too, using the same privacy rules as operations; keys remain separate from both data snapshots and the token resource. Otherwise an old backup would forget a newer operation's seal or alias token and an old retry could reappear. Control copies contain no original payload/metadata/raw hashes. Loss of this authority or necessary verifier key blocks activation/import, rather than silently discarding suppression. This is an implementation requirement of the adopted anti-resurrection contract, not another erasure choice.

### Quarantined restore protocol

1. Restore the selected allowed backup into an isolated store with user reads, indexing/embedding, exports, imports, notifications and action dispatch disabled. Do not expose a preview of restored content.
2. Fetch the **latest independent ID-only list** and current suppression/retry/sequence control state; never replace them with an older backup's versions. Verify authenticity/completeness and the 30-day eligibility of every input. Missing/stale control state keeps quarantine closed.
3. Match restored records by `id in list OR root_id in list`. Expand each matching root to **all** restored revisions, including previously unknown revision IDs, sources and approved dependent roots; add any newly discovered member IDs to the current list. Apply the uniform NULL-domain stub/metadata rules before any indexing, content preview, new backup or user access. Review any newly discovered revealing dependent that was not already authorized; it blocks release pending Lucas's per-record confirmation, never silent retention/redaction.
4. If the old backup lacks the original erase operation, allocate a **fresh replay erase operation** with a new UUID and sequence above the independently retained committed high-water, record only safe manifest/tokens, and use that sequence for newly sanitized rows' erasure_op_seq. Keep original creation sequences. Restore-time replay is distinct from retrying the original operation, whose own sequence/scope remain sealed. A list of IDs alone cannot reconstruct an absent operation row, and the protocol does not pretend it can.
5. Carry forward sealed operation IDs and all known source tokens separately; compute additional known-byte/identity tokens before wiping restored sources, with the protected current verifier keys. Reject replay/import/stale client attempts during quarantine. Never recover a missing key from the data backup or expose a lookup oracle.
6. Verify local physical/artifact cleanup, FK/stub/envelope invariants, sanitized history/feed/operations, complete dependency dispositions and suppression. Rebuild only from clean non-erased rows. Preserve the authoritative sequence floor, create a new opaque store-history incarnation and require clients to resync/purge old caches; old cursors never silently cross the restore.
7. Release quarantine only after these checks and the required restore/deletion drill pass. Backup_state remains expiry_pending if any permitted raw pre-erasure PITR/export copy survives; an operationally clean restored store does not imply those historical bytes have vanished.

### Rejected alternatives

| Alternative | Decision |
|---|---|
| Option 2: remove the entire lineage and its IDs | **Rejected.** Stable opaque FK targets and irreversible no-resurrection barriers survive in tombstones. |
| Option 3: export before erase | **Rejected / not adopted.** Erasure creates no export/archive. Export-before-erase is only a possible later addition requiring a separate Lucas decision and retention treatment. |

## Erase operation, receipt, feed and anti-resurrection

Erasure is **one logical operation with its own random client_op_id** and one accepted op_seq E. It takes a reviewed exact scope (complete target roots, every confirmed dependent disposition, known source aliases/artifacts and affected prior operation IDs). It is not a per-row loop that commits partial successes. Scope/approval changes require re-review; no inferred expansion, silent retention or quote-bearing plan snapshot is accepted.

Before local acceptance, the approved record/root IDs are durably added to the independent ID-only erasure list described under backups. Reads, writes and imports of that scope are fenced. If that list cannot be durably updated, fail closed: do not acknowledge erasure or allow use of a partially sanitized store. Then one SQLite transaction performs all local state/payload/operation sanitization, with the ordering and FK checks above, and records E. A failed local transaction rolls back its SQL; the already-authorized ID-list barrier remains and the store keeps the affected scope fenced until the same approved erasure is applied. This deliberately favors non-resurrection over pretending external/catalog and SQLite writes form a distributed atomic transaction.

The accepted receipt contains only client_op_id, E, opaque record_ids/root_ids/affected_operation_seqs, confirmed dependent action codes, and local/backup/client verification state. No title, original kind, person, timestamp, reason, URI, source text, old digest or input payload. It is derived from operations.erasure_manifest plus erased envelopes, not a copied fact/old response. A local_pending/failed result is not local erasure complete. local_verified requires unreachable live content **and** verified local artifact/DB-page/WAL/cache/index/log cleanup; backup_state=expiry_pending honestly acknowledges recoverable retained copies until expiry/urgent scrub verification. Disconnected clients remain refresh-pending until they apply/acknowledge the notice; no claim of remotely wiping unknown offline copies. No successful full-erasure claim while an unaccounted recoverable copy exists.

### Operations metadata for erasure (no new fact table)

The operations table below defines erasure_manifest (only opaque IDs/action codes), blocked_source_tokens (keyed opaque aliases), erasure_state and backup_state. Only an erase operation has these fields; an ordinary sealed operation retains no secret-bearing request/receipt, just its safe operation identity/control state. Erasure progress statuses may advance in place without changing E; an idempotent replay/poll returns current safe verification status. New or changed content scope is a different operation and approval, never a status update.

For an old write whose results/inputs are erased, keep its random client_op_id and op_seq, set retry_policy=sealed, clear digest/time, and return `result_erased` with safe opaque handles for any retry. A mixed original write is sealed as a whole; replay must not recreate erased rows while returning surviving results. Retrying the erase itself returns the **same E and scope** without another sequence, marker update, export, import or artifact task. An altered body under a sealed id is never executed or used to enlarge scope. A new erase request concerning only already-erased IDs returns their existing safe receipts without accepting another operation. Existing tombstone IDs permanently reject refill/restore/revision, even under a new client_op_id.

### Feed replacement for erased mutable history

- **Operations since N** still returns newly accepted operations in sequence order, including operation_kind=erase with its safe manifest. Older affected operations have their digest/time cleared in place; E lists their opaque sequences so clients invalidate any cached receipts as well as records. No historical API can return pre-erasure operation metadata.
- **Records changed since N by kind K** is a merge ordered by `(change_sequence,id,change_type)`: ordinary creation/revision records with `N < op_seq <= H AND kind=K AND is_erased=0`, plus **all erasure notices** with `N < erasure_op_seq <= H AND is_erased=1`, regardless of K. The latter uses `(erasure_op_seq,id)`, because original kind is now NULL and cannot be trusted for filtering. It returns only id/root_id, is_erased=1, is_current=0, original op_seq and E. No typed payload join is attempted for these notices. Every kind subscriber receives the same opaque invalidations; duplicates across kind subscriptions are harmless.
- All revisions of an erased lineage are sanitized at E. They keep their creation op_seq; erasure_op_seq supplies the new change position. Client deduplication is by `(change_sequence,id,change_type)`, not record ID alone: the same ID's later erasure must purge every cached revision, reference preview, evidence excerpt, derived index and old receipt. Root invalidation is idempotent. Pagination drains an entire operation or resumes by the full merged cursor; shared high-water rules remain. No extra event/payload-copy table or new erasure fact row is added.
- Erasure overrides the previous ordinary-content immutability assumption. An old page/history/as-known query must return erased/unavailable after E, not reconstruct a pre-erasure payload. Before sending a page, check the current independent erasure barrier even if a SQL snapshot began earlier; drain/revoke stale reads, shared exports and workers before acknowledging local erasure. Earlier H is not authorization to transmit a secret erased later. Snapshot/cursor invalidation fails closed with resync required if a safe delta cannot be proven.
- Restore first re-applies the independent ID-only list in quarantine, preserves/reconciles sequence high-water from the current authoritative history, then forces client resync under a new store-history incarnation. Exact wire format/physical deployment belongs to implementation; it must not silently reuse sequences/cursors or serve a restored pre-erasure state.

### Repeated imports and source aliases

Before wiping sources, compute versioned, domain-separated per-store HMAC-SHA-256 tokens for every known immutable source's original bytes and stable provider/object/message identities/known aliases. Store **only tokens** in blocked_source_tokens on E: no raw provider IDs/URLs, names, excerpts, plain hashes, payload length/time or reversible encoding. Distinct domains separate request digests from source-byte and source-identity tokens. Verifier secrets stay outside the data DB/ordinary backups; retained key versions must remain available to ingestion without exposing a public membership/guessing oracle. This is keyed pseudonymous suppression state, not a guarantee of anonymity.

Every ingest/import/replay checks the ID-only list, existing erased stubs and known alias/byte tokens **before creating any row/source/artifact**. A repeated import with a new operation/filename but the same known identity or bytes is blocked with a generic source_erased response. A matching old operation is sealed regardless of its body. An unavailable verifier/catalog is a failure to ingest, not permission to skip suppression or rotate away old tokens. Blocked re-import creates no content-bearing failure log; a generic aggregate rejection may be reported without echoed source values.

Honest limit: no exact fingerprint can recognize every rewritten account, transformed screenshot, newly assigned provider identity, changed OCR or semantic restatement. Unknown aliases must not be falsely labeled proven-safe or automatically merged into an erased root. If a suspected match is ambiguous, block automatic ingestion and obtain a new Lucas decision; known match barriers are not lifted by merely changing client_op_id. Truly new independently supplied material can exist only under new non-erased IDs and explicit fresh intent; it is never restoration of an old root. Key compromise or an untracked uncontrolled copy also prevents an unconditional no-resurrection claim and must fail the relevant drill, not be concealed by a success flag.

## Idempotency and reconciliation

operations.client_op_id is unique across the store. An open write with the same versioned HMAC request digest returns original creation identities/sequence without writing; a different digest conflicts. A sealed id returns only its safe closed receipt, regardless of attempted new body, and cannot execute or enlarge scope. Normal logical writes commit all room/link/source rows with one operation; corrections/revisions use new IDs. Ordinary result IDs come from records.op_seq; erase instead uses its opaque manifest and erasure_op_seq. Aborted local SQL creates no accepted operation, while an already acknowledged independent erasure barrier remains fail-closed until applied. Source IDs are not operation IDs; overlap/receipt/OCR reconciliation still requires evidence, not time/content heuristics. Suppression applies before any re-ingestion. Foundation: Finances #2; Music #1; Relationships #2; Memory and continuity #6, #10; Lucas erasure decision.

## Shared tables (part of the spec for every room)

### `operations` — one accepted logical write

Foundation: Memory and continuity #1, #6; Initiative and action #9. Retry mechanics are proposed technical defaults.

| Column | Type | Nullability | Meaning |
|---|---|---|---|
| op_seq | INTEGER | NN | Positive store sequence; PK, SQLite AUTOINCREMENT allocation on acceptance. |
| client_op_id | TEXT | NN | UUIDv4 caller operation ID; UNIQUE across store, stable on replay. |
| operation_kind | TEXT | NN | `write` or `erase`; no room/subject classification. |
| retry_policy | TEXT | NN | `open` for ordinary request comparison; `sealed` forbids every subsequent execution under this id. |
| request_digest | TEXT | NULL | Versioned HMAC-SHA-256 on open writes; NULL after affected erasure and on erase operations. |
| ingested_at | TEXT | NULL | Required acceptance time on open writes; cleared on sealed/erase operations. |
| erasure_manifest | TEXT | NULL | Erase only: validated JSON object with record_ids/root_ids (UUID arrays), affected_operation_seqs (integer array), dependent_decisions (one {root_id, action} per dependent root, action erase/retain_nonrevealing), artifact_ids (opaque UUID array). No content, original kinds, times, names or locators. |
| blocked_source_tokens | TEXT | NULL | Erase only: JSON array of domain/key-version-prefixed HMAC-SHA-256 tokens for approved known source identities/bytes; empty array permitted, no raw hashes/keys/source IDs. |
| erasure_state | TEXT | NULL | Erase only: local_pending, local_verified or failed; safe mutable verification status, no new sequence on progress/retry. |
| backup_state | TEXT | NULL | Erase only: expiry_pending or verified; verified only after every covering recoverable backup/export copy is gone or unrecoverable. |

Constraints/indexes: PK op_seq; UNIQUE client_op_id; full UNIQUE `(client_op_id,op_seq)` for live records membership. CHECK open implies write plus non-NULL digest/time; sealed implies NULL digest/time, and erase is always sealed. Erase requires manifest, token array and verification states; write requires all four NULL. Validate exact JSON shapes, UUID/integer/token types, no duplicate IDs and approved scope; do not permit arbitrary JSON fields. Ordinary writes create at least one record; erase instead sanitizes existing records through erasure_op_seq. Read-only/rejected/no-op already-erased calls create no accepted operation. Sequence never resets/reuses. All operation IDs are random UUIDv4, never content/provider-derived keys. Token membership can be checked with validated JSON iteration; it is not claimed to be a plain per-token unique index.

### `records` — provenance, time, and revision envelope for every typed row

Foundation: Memory and continuity #1–7, #10; Overview #4, #8.

| Column | Type | Nullability | Meaning |
|---|---|---|---|
| id | TEXT | NN | Revision UUIDv4; PK. |
| kind | TEXT | NN live | Exact typed table live; NULL erased to remove classification. |
| root_id | TEXT | NN | FK records; first revision, self on original. |
| is_current | INTEGER | NN | 0/1; 1 only on sole terminal non-deleted revision; mechanical flip rules above. |
| is_erased | INTEGER | NN | 0/1; irreversible erased-content state, 0 ordinary; mirror authority for payloads. |
| erasure_op_seq | INTEGER | NULL | FK operations.op_seq; required exactly when erased, immutable sequence of accepted erase. |
| supersedes_id | TEXT | NULL | FK records; immediately preceding revision. |
| change_kind | TEXT | NN | `original`, `correction`, `revision`, `delete`, `restore` live; constant `erased` on every erased revision. |
| change_reason | TEXT | NULL | Required for non-original; why the account/decision changed. |
| event_start_at | TEXT | NULL | Actual event start/effective instant; not a plan. |
| event_end_at | TEXT | NULL | Actual end, if reported/observed. |
| time_precision | TEXT | NN live | Enum live; NULL erased, not an unknown observation. |
| reported_at | TEXT | NULL | Original assertion time. |
| ingested_at | TEXT | NN live | Revision acceptance time live; NULL erased. |
| attribution_date | TEXT | NULL | Chosen local accounting date. |
| time_zone | TEXT | NULL | IANA zone for attribution/event context. |
| attribution_basis | TEXT | NN live | Basis enum live; NULL erased. |
| asserted_by | TEXT | NN live | Speaker/source enum live; NULL erased. |
| captured_by | TEXT | NN live | Capturer enum live; NULL erased. |
| client_op_id | TEXT | NN live | FK operations.client_op_id live; NULL erased, while original op_seq survives. |
| op_seq | INTEGER | NN | FK operations.op_seq; original creation sequence, retained unchanged even erased. Composite operation membership also applies live. |
| deleted_at | TEXT | NULL | Tombstone time; otherwise NULL. |

Constraints: flags in (0,1); the complete two-state erasure allowlist is a required CHECK policy. Live state requires NN-live fields, erasure_op_seq NULL and ordinary time/revision/source rules. Erased state requires is_current=0, change_kind=erased, erasure_op_seq non-NULL, and every cleared field in the allowlist NULL. A root is entirely erased or non-erased (commit validation). Live soft delete requires deleted_at and is_current=0; restore requires a non-erased terminal soft tombstone. Indexes: PK; UNIQUE supersedes_id (non-NULL); full UNIQUE `(id,is_current,is_erased)` and `(id,root_id)`; partial UNIQUE `(root_id) WHERE is_current=1`; `(root_id,op_seq)`; `(kind,attribution_date)`; `(kind,event_start_at)`; `(client_op_id,op_seq)`; `(op_seq,id)`; `(kind,op_seq,id)`; `(erasure_op_seq,id)`; `(ingested_at)`. Live `(client_op_id,op_seq)` has a composite FK to operations. Independent op_seq FK keeps erased creation membership valid; erasure_op_seq must refer to operation_kind=erase (commit validation). There is no per-record sequence allocator.

### `sources` — retained reports, documents and original evidence

Foundation: Memory and continuity #1, #10–11; Mind #2; Learning #1; Inventory #2; Relationships #2; Music #5; Finances #2.

| Column | Type | Nullability | Meaning |
|---|---|---|---|
| id | TEXT | NN | PK/FK records. |
| is_current | INTEGER | NN | 0/1 mirror of records.is_current; composite FK (id,is_current,is_erased), ON UPDATE CASCADE; deferred state match. |
| is_erased | INTEGER | NN | 0/1 mirror of records.is_erased; 1 means same-id stub with every domain column NULL. |
| medium | TEXT | NN live | `text`, `audio`, `image`, `document`, `web`, `provider_record`, `artifact`. |
| original_text | TEXT | NULL | Original words or retained source payload; not a synthesis. |
| artifact_uri | TEXT | NULL | Address of original bytes/material; no binary embedding required. |
| extracted_text | TEXT | NULL | Searchable transcription/OCR; independently correctable revision. |
| provider | TEXT | NULL | Source system or import origin. |
| external_id | TEXT | NULL | Provider's identifier; may identify a report rather than an event. |
| locator | TEXT | NULL | Page, timestamp, message span, URL fragment or artifact location. |
| parent_source_id | TEXT | NULL | FK sources; original from which excerpt/extraction came. |

Constraints/indexes: at least original_text or artifact_uri; extracted_text alone is insufficient. Parent graph acyclic. Original sources may be self-evidencing (the only exception to requiring another source). Index parent_source_id and `(provider,external_id)` nonunique; extraction confidence belongs in annotations, not in original text.

### `record_sources` — evidence for a record

Foundation: Memory and continuity #1; Relationships #3–4; Learning #1; Inventory #2.

| Column | Type | Nullability | Meaning |
|---|---|---|---|
| id | TEXT | NN | PK/FK records. |
| is_current | INTEGER | NN | 0/1 mirror of records.is_current; composite FK (id,is_current,is_erased), ON UPDATE CASCADE; deferred state match. |
| is_erased | INTEGER | NN | 0/1 mirror of records.is_erased; 1 means same-id stub with every domain column NULL. |
| record_id | TEXT | NN live | FK records; supported typed revision. |
| source_id | TEXT | NN live | FK sources; original or excerpt. |
| role | TEXT | NN live | `report`, `observation`, `instruction`, `evidence`, `context`. |

Constraints/indexes: partial UNIQUE `(record_id,source_id,role) WHERE is_current=1`; index source_id. Infrastructure evidence rows inherit the evidence they attach and do not recursively require their own record_sources.

### `annotations` — authored thought, uncertainty, decision and evaluation

Foundation: Memory and continuity #2, #5–7, #12; Associative Intelligence / Connections and understanding #4–9; all rooms' reflection requirements.

| Column | Type | Nullability | Meaning |
|---|---|---|---|
| id | TEXT | NN | PK/FK records. |
| is_current | INTEGER | NN | 0/1 mirror of records.is_current; composite FK (id,is_current,is_erased), ON UPDATE CASCADE; deferred state match. |
| is_erased | INTEGER | NN | 0/1 mirror of records.is_erased; 1 means same-id stub with every domain column NULL. |
| subject_id | TEXT | NN live | FK records; record being discussed (including another annotation). |
| category | TEXT | NN live | `question`, `idea`, `interpretation`, `hypothesis`, `prediction`, `proposal`, `decision`, `feedback`, `outcome`, `reflection`, `profile_claim`. |
| body | TEXT | NN live | Authored claim, question, reasoning or reflection in its own words. |
| status | TEXT | NN live | `explored`, `proposed`, `adopted`, `disputed`, `rejected`, `retired`, `unknown`. |
| confidence | REAL | NULL | Author's stated confidence 0–1; NULL if unspecified, never default certainty. |
| review_at | TEXT | NULL | Explicitly chosen future review instant. |

Constraints/indexes: model interpretations stay here; adoption needs a user decision source or explicitly recorded delegated decision authority. Outcome annotations target the evaluated prediction/proposal/decision; never overwrite the claim with the observed result. Index `(subject_id,category,status)` and review_at. Supporting evidence uses record_sources and `evidence` links; feedback/revision links preserve disputed accounts without relabeling guesses as facts.

### `record_links` — typed, evidenced relationships across records

Foundation: NOVA / How the parts work together #7–8; Associative Intelligence / Connections and understanding #1–9; Memory and continuity #8–11.

| Column | Type | Nullability | Meaning |
|---|---|---|---|
| id | TEXT | NN | PK/FK records. |
| is_current | INTEGER | NN | 0/1 mirror of records.is_current; composite FK (id,is_current,is_erased), ON UPDATE CASCADE; deferred state match. |
| is_erased | INTEGER | NN | 0/1 mirror of records.is_erased; 1 means same-id stub with every domain column NULL. |
| from_id | TEXT | NN live | FK records; subject revision. |
| to_id | TEXT | NN live | FK records; object revision. |
| relation | TEXT | NN live | Relation from CROSS_ROOM registry or local `evidence`, `speaker`, `same_as`, `material`, `evaluates`, `related_context`. |
| participant_role | TEXT | NULL | Required only for involves_person: `participant`, `supervisor`, `collaborator`, `group_member`; NULL for every other relation. |
| status | TEXT | NN live | `proposed`, `adopted`, `rejected`, `retired`. |
| rationale | TEXT | NULL | Explanation of the connection; required for proposed inferred connections. |
| confidence | REAL | NULL | Stated uncertainty 0–1, principally for model associations. |

Constraints/indexes: no self-link except source evidence via record_sources; partial UNIQUE `(from_id,to_id,relation) WHERE is_current=1 AND relation<>'involves_person'`; partial UNIQUE `(from_id,to_id,relation,participant_role) WHERE is_current=1 AND relation='involves_person'`; CHECK participant_role non-NULL exactly for involves_person and within its vocabulary. Index `(from_id,relation,status)` and `(to_id,relation,status)`. Endpoint kinds and ownership must satisfy CROSS_ROOM. Evidence-bearing links inherit sources from endpoints or have independent source rows; they do not recursively need record_sources. An inferred `related_context` link asserts association, never cause. A direct FK takes precedence; never store a duplicate generic link for the same relationship. A person may have distinct reported roles in an activity. Health-context links require user report evidence, not model inference.

## Cross-room integrity and reading

All links stay within the same store. With the proposed single-store database, typed direct FKs and record_links endpoint FKs are real SQLite FKs. Current-key uniqueness is enforced by the specified single-table partial indexes and the marker mirror FK; the remaining invariants below need more than a plain index. FK checks may be deferred until transaction commit for mutually referencing transfer rows and the envelope/payload/source transaction, but unique-index checks are immediate. No opaque string path masquerades as a FK. Artifact/provider URIs address external material and cannot substitute for local record identity. If a later implementation splits room stores, it needs a separate external-reference protocol; this spec does not assume cross-database SQLite FKs.

The room requesting time owns a Schedule signal's subject; Schedule owns its placement, recurrence and plan history. Owning rooms keep the actual record: Schedule actuals describe time use, not a second habit completion or financial payment. Finance owns amounts/postings; Inventory owns the item; their association is a link. The same approach applies to assignments opened by study blocks, Focus intentions, and routines in Schedule. [CROSS_ROOM.md](CROSS_ROOM.md) enumerates endpoints, owners, and mechanisms. Overview computes its combined read without any new facts.

## Review convention for room documents

Each table lists id/is_current/is_erased and all domain columns. Other envelope columns live in records. NN live means required only for is_erased=0 (including ordinary historical/soft-deleted rows); physical domain columns are nullable and all become NULL in a stub. One guarded live-versus-erased CHECK policy applies to every payload, plus the always-enforced id/state checks and deferred triple FK. Source/type/graph/aggregate semantics recognize unavailable erased endpoints without inventing values; they still fully validate unaffected live facts. Partial UNIQUE keys/predicates are actual same-table indexes and exclude erased rows through is_current=0. Index every FK unless a listed compound index starts with its key. Ordinary content uses revision/source history; hard erasure is its explicit destructive exception. Source citations justify purpose, not an assertion that the Foundation prescribes these columns.

## Integrity rules that still need more than a plain index

These are required transaction/trigger validations unless identified as a same-row CHECK or FK. The spec does not claim an index enforces them. All mutable metadata changes remain inside the accepted write transaction.

| Rule | Why a plain index is insufficient / enforcement |
|---|---|
| Exactly the terminal live revision is current; zero current iff soft-deleted or whole root erased | A partial root UNIQUE gives only at-most-one. Predecessor/root kind, no cycles, no stale/branch successor and the existence/correctness of the marker need lineage inspection plus the transition protocol. UNIQUE supersedes_id blocks two successors, not an incorrect marker. |
| Exactly one typed payload/stub, live kind/source evidence, accepted operation result scope | These are existence/type/count assertions across tables. Payload marker equality and operation membership **are** composite FKs; exactly-one matching live payload or erased NULL-kind stub and required live source roles need commit validation. Erase operations update existing rows and have manifests instead of created-row results. |
| Root mirrors for schedule series and finance obligations, original-root identity | `(series_id,series_root_id)` and `(obligation_id,obligation_root_id)` can be composite FKs to records(id,root_id); typed target FKs and paired-null CHECKs are also real constraints. The lineage rule that a root is an original of the right kind still needs validation. |
| Typed record_links, generic subject/purpose/cue/activity/authority/source endpoint semantics | records FK proves existence only, not allowed room kind, source medium, claimed speaker/adoption authority, role meaning or that another FK makes a link redundant. Enforce registry and provenance transactionally. |
| Acyclic dependencies/hierarchies, reply order, same_as canonical graph | Edge indexes ensure no duplicate edge only; cycle/transitive reachability and shared parent/order constraints require graph/related-row checks. Self-edge prohibition is a row CHECK. |
| Routine performance step belongs to run's exact definition; habit matches step | Membership spans run, step and habit tables; validate together, including corrected snapshot resolution. |
| Schedule placement disposition, series-rule expansion, DST resolution, current interval conflicts | At least one adopted block for placed signals and correct recurrence/DST/occurrence identity need related-row/timezone validation. Overlaps are deliberately allowed and queried, never rejected by an index. |
| Scale bounds, calorie/recipe scaling, source units, actual/plan parent types | Mind/Habits rating bounds and unit/definition references span rows; plan/actual or symptom/injury endpoint kinds and ingredient yield require validation. Numerical totals/trends stay computed. Simple nonnegative, enum, field-pair and reason-status rules are same-row CHECKs, not indexes. |
| Financial split totals, settlement capacity, reciprocal transfers and currency consistency | Sum constraints/peer account semantics/currency agreement span rows. UNIQUE settlement pair does not enforce aggregate allocated amounts. Validate atomic writes; derived balances/cashflow remain views. |
| Financial goal allocation is one explicit delta, not double counted cash | User-adopted earmark/contribution semantics and already allocated resources must be checked against evidence; no index can prove the economic identity of funds. |
| Health/pain/supervision/alone consistency | User-reported health relation, active participant roles vs alone, parent-workout context and whether a person was actually present need source and cross-row validation; absence of a link never means alone. |
| Inventory ownership report/event coherence, available stock and time-ordered state | Coordinated reports must cite the same supplied change; state, maintenance dues, ties and stock coverage are computed from event history rather than enforced by a unique index. |
| Focus action confirmed/authority/trigger belongs to same session, meaningful feedback/outcome | Requires related confirming evidence and matching session/authority context, not just a unique key. |
| Historical/current endpoint resolution, source correction, snapshot children | An FK pins a revision, not a lineage's accepted current account; reader/transaction rules distinguish correction from deliberate revision without corrupting pinned history. |
| Append-only content, sequence allocation, feed resync and hard erasure | PK/UNIQUE prevent duplicate IDs/sequences; guarded writes/allocator protocol must prevent arbitrary mutation, allocation reset and unauthorized marker changes. Erasure and 30-day backup policy are adopted, with explicit stub/NULL-kind/history exceptions; dependency confirmation, durable barriers, physical purge, quarantine and expiry still require implementation/drill evidence. |
