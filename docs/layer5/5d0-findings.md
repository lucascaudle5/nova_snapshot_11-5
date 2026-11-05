# Layer 5d-0 findings



## Inventory



Checked the room schema documents and `db/rooms/{body,mind,schedule}.sql`; no DDL change is needed for the requested read views or multi-record verbs.



| Requested item | Storage and columns | View/verb feasibility without schema change |

|---|---|---|

| Mind medication list | `mind_medications`: `id, is_current, is_erased, name, dose_text, instructions, reminder_rule, reminder_zone, status`; event/attribution envelope is on `records`. | MND-05 is possible from current medication rows and records lineage. Medication-use verb can create a `mind_medication_reports` row and evidence source through one registry operation. |

| Mind rating qualities | `mind_qualities`: `id, is_current, is_erased, name, minimum, maximum, anchors`. | MND-06 is possible from current quality rows. `mind.log_entry` can create the entry and one or more ratings atomically; the registry scale rule checks numeric bounds. |

| Body program definitions | `body_programs`: `id, is_current, is_erased, name, purpose, goal_id, progression, status`; `body_program_steps`: `id, is_current, is_erased, program_id, session_key, position, exercise_id, sets, repetitions, resistance_grams, duration_seconds, distance_meters, prescription`; exercise names live in `body_exercises`. | BOD-08 can resolve an arbitrary program revision via `records.root_id` and read the current program plus its current steps. `body.log_workout` can create an actual workout and zero or more sets atomically. |

| Body targets and preferences | `body_nutrition_choices`: `id, is_current, is_erased, kind, description, nutrient, target_value, unit, period, comparison, status`. | BOD-09 is possible; stored targets/preferences are present. |

| Schedule labels | `schedule_labels`: `id, is_current, is_erased, name`. | SCH-08 is possible from current non-erased labels. |

| Reusable schedule arrangements | `schedule_sets`: `id, is_current, is_erased, name, circumstances, status`; `schedule_templates`: `id, is_current, is_erased, set_id, title, day_offset, local_start_time, duration_seconds, kind, subject_id, preparation`. | SCH-09 is possible; storage includes the reusable set and its template rows. |

| Schedule signal placement | `schedule_signals`, `schedule_blocks`, and `schedule_signal_blocks` exist. A registry request can create an adopted block, create the signal/block link, and correct the signal disposition in one atomic write. | `schedule.place_signal` is possible if the linked block and signal are validated and every write is submitted together. No schema change is indicated. |



The inventory is based on declared schema storage, not fixture presence. All these facts can be exposed without adding tables. The required read views will use current, non-erased rows and lineage resolution for ID parameters; the verbs will use the existing registry and evidence model.
## Read views

Added six views; the catalog and generated schema now contain 92 views total.

| View | Columns | Params | Coverage basis |
|---|---|---|---|
| MND-05 | `medication_id, name, dose_text, instructions, status, reminder_rule, reminder_zone, cov_known, cov_unknown, cov_expected, cov_from, cov_to, basis` | `:limit` | Each returned current non-erased regimen row is known; reminder fields do not imply a use report. All regimen statuses remain visible. |
| MND-06 | `quality_id, name, minimum, maximum, anchors, cov_known, cov_unknown, cov_expected, cov_from, cov_to, basis` | `:limit` | Each current non-erased user-defined scale is known; nullable bounds stay NULL. |
| BOD-08 | `program_id, program_name, purpose, goal_id, progression, status, step_id, session_key, position, exercise_id, exercise_name, prescribed_sets, prescribed_repetitions, prescribed_resistance_grams, prescribed_duration_seconds, prescribed_distance_meters, prescription, cov_known, cov_unknown, cov_expected, cov_from, cov_to, basis` | `:program_id, :limit` | Current program definition and current ordered steps; `cov_expected` counts stored steps. A selected program with no steps is still returned with NULL step fields and zero known steps. Any program revision ID resolves through `records.root_id`; program, goal, step and exercise pins use correction resolution. |
| BOD-09 | `choice_id, kind, description, nutrient, target_value, unit, period, comparison, status, cov_known, cov_unknown, cov_expected, cov_from, cov_to, basis` | `:limit` | Current non-erased user-selected target/preference rows; absent numeric targets remain NULL. |
| SCH-08 | `label_id, name, cov_known, cov_unknown, cov_expected, cov_from, cov_to, basis` | `:limit` | Current non-erased label definitions. |
| SCH-09 | `set_id, name, circumstances, status, template_id, template_title, day_offset, local_start_time, duration_seconds, kind, subject_id, subject_room, preparation, cov_known, cov_unknown, cov_expected, cov_from, cov_to, basis` | `:limit` | Current reusable arrangement and current template rows; template count is explicit, and no concrete occurrence is inferred. A set with no templates returns a row with empty template fields. Pinned set and subject links resolve corrections. |

Every view uses a positive bounded limit (runner maximum 500), stable ordering, explicit aliases, current non-erased facts, and the room’s reserved IDs. The read views are date-free. No existing view columns or tool inputs changed. The sweep builders create their required medication, scale, program/step, target, label and schedule-set/template fixtures; the shared DB assertions cover empty data, NULL optional values and correction neutrality.

## Write verbs

All four tools are registered in `src/mcp/register-write.ts`; `nova.describe` sources the same verb list. No `server.ts` change was needed. Each verb validates a strict input schema, uses an owner/tool write rate limit and the write kill switch, resolves target names/IDs in an allowlisted Ledger method, cites one text source containing `said`, sets `captured_by='model'`, and issues one atomic `write-1` registry request. Actuals use Central attribution date/time zone; a supplied date is `user_selected`, while a default or event-time-derived date is `derived`. Future actual dates and future Mind event times are rejected. Omitted optional report fields remain NULL. Retries reuse `client_op_id`; operation-aware target resolution preserves the original selector mapping for digest-stable replays.

| Verb | Input and write | Success reply |
|---|---|---|
| `body.log_workout` | `client_op_id, status, said, date?, reason_code?, reason_text?, pain_discomfort_text?, context?, program?, session_key?, sets[]`. Status is `done`, `partial`, `not_done`, or `unknown`; `done` maps to stored `completed`. Creates one `body_workouts` actual plus 0–48 sets. Program accepts a current name or any revision ID; each set’s `exercise` accepts a current name or any revision ID. | Registry receipt plus `{ workout: { id, program, date } }`. |
| `mind.log_entry` | `client_op_id, account, said, context?, event_time?, time_precision?, date?, ratings[]`. Creates one `mind_entries` row plus 1–48 `mind_ratings`. Each rating has a quality selector and exactly one of `numeric_value` or `label_value`. | Registry receipt plus `{ entry: { id, date } }`. |
| `mind.log_medication_use` | `client_op_id, medication, use_status, said, experience?, date?`. `use_status` is exactly `taken`, `not_taken`, `partial`, or `unknown`. Creates one `mind_medication_reports` row. | Registry receipt plus `{ medication: { id, name }, date }`. |
| `schedule.place_signal` | `client_op_id, signal_id, title, planned_start_at, planned_end_at, time_zone, kind, flexibility, said, decision_reason?`. Signal selector accepts any revision ID or an exact case-insensitive signal reason. Kind is `activity`, `free_time`, `travel`, `setup`, `cleanup`, or `transition`; flexibility is `fixed`, `movable`, or `unknown`. Creates an adopted block, corrects signal disposition to `placed`, and links the signal to the new block in one operation (ordered to satisfy S01). | Registry receipt plus `{ placement: { signal_id, block_id } }`. |

Body workout `reason_code` accepts exactly `time`, `pain_or_health`, `energy_or_mood`, `competing_obligation`, `environment_or_resources`, `changed_intention`, or `other`; reason fields are allowed only with `not_done`, and `reason_text` requires a code. A missing exercise name returns `exercise_not_found`; duplicate names return `ambiguous_exercise`. Programs, qualities and medications return corresponding `*_not_found` or `ambiguous_*` codes. Mind numeric ratings are checked against any defined minimum/maximum. Label values must equal an exact anchor token; anchor text is split on comma, semicolon, pipe, or newline because the schema stores anchors as text rather than a structured label table. A nonmatching or unlisted scale value returns `rating_out_of_scale`. A missing/ambiguous signal returns `signal_not_found`/`ambiguous_signal`.

Shared pre-write errors are `invalid_params` (with a field hint), `writes_disabled`, `rate_limited`, and `storage_unavailable`. The registry’s safe error codes, including `digest_conflict`, `rule_violation`, `reference_missing`, and `stale_predecessor`, pass through without SQL, paths, stack traces, or record contents. Validation and target-resolution errors occur before registry writes. Soft-deleted and erased targets are excluded from the resolver; the worker tests cover soft-delete and erased-revision misses.

## Skips, counts and verification

No requested view or verb was skipped. The schedule signal operation is supported by the registry: the block, signal correction and placement link are submitted together and the workerd test exercises the S01 disposition rule. No DDL changes, existing view-column changes, existing tool-input changes, `src/mcp/server.ts` changes, artifacts changes, Habits-file changes, or `scripts/ci-policy.ts` changes were made. The only view-count assertions updated from 86 to 92 are in `test/workers/views-all.test.ts`, `test/workers/read-tools.test.ts`, and `docs/layer5/5A_CONTRACT.md`; descriptor count remains 111 tables.

## Verification results


npm run check passed after increasing the catalog metadata scan test timeout to 15 seconds. It ran check:ci, generated 92 views, built the widget at 284.71 kB, completed typecheck and lint, and passed all suites: unit 76/76, workers 178/178, browser 24 passed and 6 skipped by suite configuration.
npm run build:descriptors passed earlier with 111 tables, 113 vocabularies and 68 numeric bounds. The targeted view-mutation harness changed all six added views and confirmed all six mutations were caught. No requested view or verb was skipped.

Not verified: deployment or behavior against a live Cloudflare store; no deployment, push, or Cloudflare login was performed.
Step 3 commit: `layer5d0: add room write verbs` (hash reported in the completion summary).
