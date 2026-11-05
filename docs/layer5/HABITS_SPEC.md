# Layer 5c artifact spec: Habits

## Purpose and conventions

Use `docs/design/mockup-v1-habits/index.html#view-habits` as the visual source, styled with `docs/layer5/STYLE_GUIDE.md`. The original page is reference material; its example rows, statuses, times, step sources, and Second Voice prose are illustrative and are not NOVA records. Preserve the composition and hierarchy while using only values the tools can support.

Treat the artifact as an untrusted client. Discover tools with `nova.describe`; read only declared views and parameters; keep durable data in the server store. Use synthetic data until the deletion-drill gate in `docs/LAYER5_PLAN.md` passes. Use `America/Chicago` for “today,” date labels, range boundaries, and attribution. Weeks begin Sunday. Read calendar months with explicit inclusive `from_date` / `to_date`. A Sunday-first November 2026 grid starts on Sunday November 1 with no leading blank cell. Future dates display “Ahead.”

## Original mockup regions and honest data mapping

| Mockup region | Source | Required rendering |
|---|---|---|
| Eyebrow, “What you practice,” lede | Static copy. | Preserve the typography and text. It makes no per-record claim. |
| “Morning routine · missed today” pill | `HAB-02` performance row whose `report_date` is the host's `local_date` and `reported_status=not_done`. | Show “missed today” only for this explicit report. `done`/`partial` use their reported wording. If no row exists, show “No report yet”; do not carry yesterday's miss into today. |
| Selected row in Name / Type / Frequency / Streak table | `HAB-06` current definition for a known `habit_id`: `name`, `measure_kind`, `direction`, `standard`, `frequency_count`, `frequency_period`, `status`. `HAB-02` for its streak evidence. | Use the selected current definition, not mockup wording like “Yes / no” unless a real field supports it. Frequency with a null part is “Unknown.” Streak uses `current_streak` only where the range has a known latest performance; pair the number with the HAB-02 coverage/uncertainty basis. Null/uncertain is “Unknown,” never 0. A known `not_done` breaks the confirmed run. A declared pause preserves but does not extend it. |
| Other habit rows in the mockup table | `HAB-00` lists current adopted and paused habits with definition fields and latest report as of a date. | Render only returned rows. Paused habits remain in the list; proposed and retired habits do not. A missing latest report is NULL, not a zero streak. |
| Selected month heading and day cells | `HAB-07` for the selected habit and inclusive local-date range; `HAB-01` for weekly frequency/coverage context. | Sunday-first. Map `kept`, `partial`, `missed`, `no_report`, and `paused` as returned; explicit `unknown` keeps `reported_status=unknown` and has NULL outcome. Future dates can be labeled “Ahead” by the client. Missed requires explicit `not_done`. |
| Selected day outline | Selection is local UI state, not a NOVA fact. | Use a visible focus/selection ring; it must not change the reported outcome. A user can select any date in the visible month. |
| Kept / Partial / Missed / Not due key | HAB-07 reports daily expectations only for a daily count of one with no custom rule, plus declared pauses and dates outside a dated active span. | `expected=0` is a known not-due date; `expected=1` is known due for the supported daily rule. Weekly/monthly frequency and every custom rule return NULL expectation and explain why. |
| Dark Second Voice card | Text may appear only if supplied by a stored analysis with its created time and source/evidence references. No current view or tool reads/writes a stored analysis. | Without such a record, use neutral “No analysis yet” or hide the card. Never render the mockup's canned paragraph, generated judgment, or causal statement. If a stored analysis is later supported, render its exact supplied text and identify it as analysis. |
| “This morning, as it happened” step list | `HAB-09` discovers adopted routines through `routine_steps.habit_id`; `HAB-08` returns ordered current steps, latest run status, linked report, event timestamp and source kind for a supplied routine/date. | A generic linked activity record has no common report-status field across rooms. Show its stored source kind and time when present, but leave status unknown unless a dated linked report is available. Missing report is unreported, never “skipped.” |
| Check host | `host.check` with `{}`. | Show read access success/failure, `contract_versions`, `store_mode`, `server_time_utc`, `local_date`, `view_count`, server `query_ms`, and `result_bytes`; measure client round-trip separately. Server timing/bytes describe a fixed internal sample read, not the visible Habits response. |

## HAB view parameters and coverage

Call `nova.read` as `{contract_version:"read-1",view,params}`. Dates are ISO `YYYY-MM-DD` in Chicago local dates. `limit` defaults to 100 and the public tool caps it at 100. If `truncated=true`, show the range is incomplete and narrow it before presenting totals.

| View | Parameters | Coverage and use |
|---|---|---|
| HAB-00 | `as_of_date` required; `limit` optional | Current adopted and paused definitions, effective date and most recent current performance on or before the requested date. Missing report fields remain NULL. |
| HAB-01 | `habit_id`, `from_date`, `to_date` required; `limit` optional | Sunday-start weekly outcomes and the pinned weekly target. `cov_known` = distinct dates with done/partial/not_done; `cov_unknown` = target not covered (or explicit unknown dates when pinned frequency is unavailable); `cov_expected` = target when computable. `cov_from`/`cov_to` clip the calendar-week bounds. `basis` explains frequency, unavailable frequency, or no attributed performance. Null remains “Unknown.” |
| HAB-02 | `habit_id`, `from_date`, `to_date` required; `limit` optional | Dated performance and pause-period rows, plus streak evidence. Each performance has `cov_known=1`; `cov_unknown=1` when its streak evidence is uncertain, otherwise 0; `cov_expected` is null because this is event evidence. A pause has null count fields and explicit pause dates; its `basis` says it preserves without extending. Render coverage beside streak values. |
| HAB-03 | `routine_id`, `from_date`, `to_date` required; `limit` optional | Ordered routine steps and step report statuses. `cov_known=1` when a report exists, else 0; `cov_unknown=1` for absent/unknown report, else 0; `cov_expected=1`. `basis` distinguishes missing, explicit unknown, and explicit report. There is no routine enumeration tool. |
| HAB-04 | `habit_id`, `from_date`, `to_date` required; `limit` optional | Explicit reason, pain/discomfort, social/context and reported health-context fields. Coverage counts describe the existence of each returned performance, not completeness of its optional columns. Null optional fields say “Not reported.” |
| HAB-05 | `habit_id`, `from_date`, `to_date` required; `limit` optional | Explicit automaticity reports, chosen scale, and current cue fields. Coverage is report-row coverage, not a rating inferred from repetitions. A null rating/label is unknown, never zero. |
| HAB-06 | `habit_id`, `as_of_date` required; `limit` optional | One current definition and effective attribution date. `cov_known`, `cov_unknown`, and `cov_expected` are null; say “Coverage not provided for this definition view,” not 0. It does not provide full definition history. |
| HAB-07 | `habit_id`, `from_date`, `to_date` required; `limit` optional | One row per date for valid inclusive ranges shorter than 400 days. Dates use Chicago attribution dates. Only daily count=1 with no custom rule identifies due dates. Pause spans derive from dated paused definition revisions; `pause_id` is the paused revision. |
| HAB-08 | `routine_id`, `local_date` required; `limit` optional | Current steps by position, latest routine run status, linked habit report when available, event timestamp with stored time zone, and source kind label. A generic activity record does not guarantee a report-status field. |
| HAB-09 | `habit_id` required; `limit` optional | Current adopted routines containing a current step linked through `routine_steps.habit_id`; no other routine-to-habit relationship exists in the schema. |
| HAB-10 | `habit_id` required; `limit` optional | Non-erased habit revisions in operation order; changed definition fields are shown relative to the preceding revision, with effective date, recorded time, correction/revision kind, and `records.change_reason`. Corrections remain labeled as repairs. |

Read success is `{ok:true,contract_version,view,columns,rows,coverage?,truncated,generated_at}`; unknown row values remain `null`. Read errors may be `unknown_view`, `invalid_params`, `too_large`, `store_unavailable`, or `rate_limited`. Never expose raw `detail`.

## States, status, and actions

- **Loading:** show loading state without clearing a previously selected habit or replacing values with zero.
- **Empty habit list:** HAB-00 returns no rows when there are no current adopted or paused habits; do not render the example list.
- **Unknown/no report:** a date with no HAB-02 row says “No report” (today “No report yet”). Null streak/coverage/frequency says “Unknown” or “Not available.”
- **Miss:** only explicit `reported_status=not_done` is a Missed cell and breaks the streak. Never synthesize a missed row from schedule expectations.
- **Partial:** remains a separate report state; do not label Kept.
- **Pause:** show a declared pause from HAB-02. It preserves the streak but adds no done count. Unknown/uncovered gaps remain uncertain.
- **Future dates (rule found in the first live test):** views have no notion of today. HAB-01 counts every day of a requested week toward its expected total, so a range that runs past today would report future days as unknown. The artifact must clamp `to_date` to the local (America/Chicago) date from `host.check` or `local_date` before calling HAB-01 and HAB-02, and render any calendar cell after today as a plain future cell, never as no report or missed. Unknown means a past date without a report.
- **Error/rate limit:** show a short safe message near the triggering control and offer a user-controlled retry. Do not reveal tool detail or enter a retry loop.
- **No analysis:** show neutral “No analysis yet” or omit the Second Voice card. A static paragraph from the mockup is not an analysis record.
- **Routine unavailable:** keep the step-list card position and explain that no adopted routine is linked to the selected habit when HAB-09 returns no rows. Do not insert illustrative steps, times, sources, cue, or late label.
- **Coverage:** every figure gets its coverage/date basis alongside it. A null coverage column is not zero.

For writes, use `habits.log` for `done`, `partial`, `not_done`, or `unknown`; there is no `skipped` status. Use `nova.write` with the strict `write-1` registry request for definition create/revise/correct; a pause is a definition revision, not a performance status. Each new user intent gets one UUIDv4 `client_op_id`; freeze and reuse the identical request and ID after timeout. Show “Saved” only after a successful receipt. `digest_conflict` stops the retry. Safe messages for `writes_disabled`, `rate_limited`, `invalid_request`, `invalid_params`, `digest_conflict`, `habit_not_found`, `ambiguous_habit`, and `store_unavailable` come from `NovaKit.safeMessage`.

## Remaining data gaps

1. **Stored analysis (`analysis` tool/view proposal):** no read/write contract exists for saved analysis text, evidence references, or created time. Second Voice displays no analysis or neutral “No analysis yet.”
2. **Generic linked activity status:** HAB-08 can identify a linked record's kind and envelope event time, but cross-room payloads do not share a generic reported-status field. A single routine view cannot safely infer completion status for every activity kind.

## Intentional differences from the original reference

- The mockup uses Monday-first days. This page corrects it to Sunday-first per `PREFERENCES.md` and `nova.describe`.
- Hard-coded red cells become “No report” unless a not_done report exists. “Today missed” is only shown on an explicit current-date not_done.
- Mockup streak zeros, all nine habit rows, and illustrative frequencies/streaks are not copied without HAB data. Unknown remains “Unknown.”
- “Not due” is unavailable without a day-level schedule view; retain an explanatory legend state, not inferred dates.
- The reference's routine step times, “skipped,” source labels and closing observation are absent until supported by views. Missing data gets a neutral empty state.
- The dark Second Voice panel remains part of the layout, but canned prose is removed. It shows stored analysis text only; with none, neutral “No analysis yet.”
- The mockup's reference uses Fraunces, Outfit and Caveat from one optional Google Fonts stylesheet. Each has a local serif/UI/handwriting fallback. The harness tests with that request blocked.

