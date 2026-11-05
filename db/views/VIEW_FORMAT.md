# View format

Each `db/views/<room>.sql` file contains one or more read-only named queries. A view starts with this exact marker shape:

```sql
-- view: ID | room: x | answers: <doc>#<question number or text> | params: :name TYPE, ...
-- title: One-line human-readable title
SELECT ...;
```

Use a stable ID from the room's reserved prefix. The marker's parameter list is the complete public interface: every query parameter must be declared and every declared parameter must be used. Types are `TEXT`, `INTEGER`, or `REAL`. All parameters are required unless named `:limit`, which defaults to 100. `:limit` must be a positive integer no greater than 500. Give every result expression an explicit, stable alias; these aliases are the view's result columns.

## Result and knowledge conventions

- Return only current, non-erased facts unless the question explicitly asks for history. A row pinned to a historical revision may be joined to that exact revision when the answer depends on the standard chosen at the time.
- **Counts are NULL, not 0, when no known report backs them** (`cov_known` is 0 or NULL). A week with no reports shows NULL done, partial and not-done counts, never 0.
- Do not turn absent rows into negative reports. An unreported performance is unknown. When no `attribution_date` exists, the fact is unplaced and must not be assigned to a calendar day.
- For views that describe coverage, include `cov_known`, `cov_unknown`, `cov_expected`, `cov_from`, `cov_to`, and `basis`. Leave counts NULL when the expected quantity or knowledge boundary cannot be established. State the basis used to calculate coverage.
- Caller-supplied local-day UTC bounds define the requested interval. Use attribution dates for daily accounting; do not derive them from event time inside a view. Views with date parameters should document the accepted date form and inclusive/exclusive convention.
- Never sum money across currencies. Preserve each currency as a separate result or require a caller-selected currency; no implicit conversion is allowed.
- Order results stably, including a deterministic tie-breaker where rows can share the main sort key. Respect the caller's `:limit` and the hard maximum of 500.
- Durable Object SQLite allows at most 100 bound parameters per statement and statements must stay under 100 KB. Do not use CTEs in triggers (views are normal SELECT statements). Check every SQLite feature used on the actual Durable Object in the capability test.

## How to write and test a view

1. Find the exact question in `docs/schema/<room>.md` and cite its heading in `answers`.
2. Choose an ID in the reserved room prefix. Declare all named parameters and use explicit result aliases.
3. Query current facts and keep absence distinct from an explicit `unknown` or `not_done` report. Add coverage columns and describe their basis where expected counts are meaningful.
4. Load the view with `loadViews()`, inspect its schema with `describeView(id)`, and execute it through `runView(db, id, params)`. The runner rejects undeclared/missing parameters and type mismatches.
5. Add fixtures and assertions in `test/db/views-runner.test.mjs`; include a neutral correction check and a case where no report remains unknown. Then run `npm run test:db`, the Durable Object capability test, and the mutation checker.

### Worked pattern: HAB-01

`HAB-01` answers “What is my consistency or streak under the standard I chose then?” It takes a pinned habit revision and an inclusive attribution-date range. It groups by Sunday-start calendar week, reads each performance's pinned habit row for its frequency expectation, counts only explicit `done`, `partial`, and `not_done` reports, and does not create missed performances for absent days. Empty weeks retain NULL coverage and identify the lack of an attributed performance in `basis`; explicit `unknown` remains distinguishable from `not_done`.

## Pinned references (read this before joining a child to a parent)

A payload foreign key pins **one exact revision** of its parent. Two things can later happen to that parent:
- **Correction** (`change_kind = 'correction'`): the earlier account was wrong. Readers must follow the correction.
- **Deliberate revision** (`change_kind = 'revision'`): the plan or standard changed. The child stays pinned to the
  revision in force when it was written, and a new child snapshot is written for the new revision.

A query that joins `child.parent_id = parent.id AND parent.is_current = 1` loses the child as soon as the parent is
corrected (the pin now points at a superseded row). Use the shared helper `pin_resolution(pin, resolved)` instead:

```sql
LEFT JOIN pin_resolution AS pr ON pr.pin = child.parent_id
JOIN parent ON parent.id = COALESCE(pr.resolved, child.parent_id) AND parent.is_current = 1
```

`pin_resolution` is a TEMP view installed by the runner from `db/views/_prelude.sql`; it only has rows for pins
that have a correction successor, so always `COALESCE`. It follows corrections only and stops at a deliberate
revision, so an old snapshot's children still do not appear under the new parent revision. Apply it to **every**
pinned join (child to parent, allocation to goal, rating to entry, performance to habit, and so on). Historical
queries (`HIS-*`) read revisions on purpose and do not use it.

## ID parameters

A `:..._id` parameter names a record by **any revision id of it** (callers keep whatever id they first saw). Resolve it
through the lineage: `WHERE root.root_id = (SELECT root_id FROM records WHERE id = :habit_id)` and read the
**current** revision of that root. Never require `table.id = :param`: after one correction the caller's id is a superseded
row and the view would silently return nothing.

## Sweep (the test that found the pinned-reference bug)

`test/db/views-sweep.test.mjs` builds a store from all 111 fixture builders, places every record on 2026-11-04,
runs **every** catalogued view with typical parameters, requires a non-empty answer, then corrects **every** live row
with identical values and requires the answer to be identical (ids compared by root). A view that fails this is wrong.
Register your views in `db/views/sweep/<lane>.mjs`:

```js
export const sweep = {
  'BOD-04': {
    setup(fx) { /* optional: add rows with fx.build(...) so the view has something to return */ },
    params: { from_date: '2026-01-01', to_date: '2026-12-31' },   // or (fx) => ({ ... })
    // allowEmpty: 'reason'   // only when a view genuinely cannot be exercised here; state why
  },
};
```
Defaults cover dates, UTC day bounds, `:limit` and `*_id` parameters. The sweep must stay **non-vacuous**: if a view needs
rows the builders do not create, add them in `setup`.

## Durable Object query limits found in layer 3a (obey these)
- No `UNION ALL` or compound select with more than 4 terms (workerd rejects larger ones: "too many terms").
- Expression trees must stay under depth 100: no long chains of `OR`/`EXISTS` or many nested `CASE`s; split large
  payload-table enumerations into separate queries.
- No complex `GLOB`/`LIKE` patterns (long digit patterns fail); validate formats with `length`, `substr` and `CAST`.
- Named parameters work, but `sql.exec` binds positionally in order of first occurrence; the Worker adapter handles it.

## Settled conventions (see `docs/PREFERENCES.md`)
- Home time zone America/Chicago; days start at midnight; **weeks start on Sunday**; money is USD only (still integer cents with a currency code).
- **Planned pauses and declared exceptions preserve a habit streak** (they neither break nor extend it); unreported days make the streak uncertain, explicit `not_done` breaks it. Show the underlying reports and the pause periods beside the streak.
