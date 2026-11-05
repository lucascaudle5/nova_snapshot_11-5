# NOVA: reading snapshot (2026-11-05)

A read-only snapshot of the files that explain how NOVA works and what to examine. It is **not** the working repository and has no build, no tests and no history. It is cut from commit `68c6673` of the private `lucascaudle5/NOVA` repository, branch `layer5/5a-integrate` (local; at that point 51 commits ahead of origin).

NOVA is a personal "operating system": one Cloudflare Worker exposing an MCP connector, with Claude artifacts (single-file HTML pages) as the screens. It is rebuilt in strict layers. The store in use is a **sandbox with synthetic data only**; nothing real has entered it.

## Read in this order

**1. Orientation**
- `CLAUDE.md`: working rules and the principles that must not break.
- `docs/HANDOFF_2026-11-05_LAYERED_BUILD.md`: state, decisions, deploy facts. It predates the later work (Schedule, Body, Mind pages; the 5d-0 and 5d-1 views and verbs; the shared-kit polish; the erase fix). Treat the findings files below as newer.
- `docs/LAYERS.md`, `docs/PREFERENCES.md`, `docs/schema/CONVENTIONS.md`.

**2. How it works**
- `docs/LAYER5_PLAN.md`, `docs/layer5/5A_CONTRACT.md` (tool surface, `read-1`), `docs/layer3/3B_CONTRACT.md` (the write registry, `write-1`).
- `db/views/VIEW_FORMAT.md`, `db/views/CATALOG.md` (how read views are written, and the list; 100 views at this commit).
- Newest tool work: `docs/layer5/5d0-findings.md`, `docs/layer5/5d1-findings.md`, `docs/layer5/5e-ops-findings.md`.
- Erasure and its limits: `docs/layer3/3C_CONTRACT.md`, `docs/schema/DELETION_DRILL.md`.

**3. The code**
- `src/mcp/` (tool registration and services), `src/ledger/ledger-do.ts`, `src/ledger/erase.ts`, `src/ledger/write-types.ts`, `src/auth/`, `src/control/control-do.ts`, `src/time/chicago.ts`.
- `wrangler.compat.jsonc`: deployment config. **Account id, KV namespace id and the Access client id are redacted** in this snapshot.

**4. Pages and style (for UI review)**
- `artifacts/kit/`, `artifacts/habits/habits.src.html` (the pattern every page follows), `artifacts/harness/runner.mjs`, `docs/layer5/STYLE_GUIDE.md`, `docs/layer5/HABITS_SPEC.md`, `docs/layer5/5c-habits-findings.md`.

**5. Threat model and decisions**
- `docs/research/ARTIFACT_OS_FINDINGS.md`, `docs/decisions/0001` to `0006` (consent, account boundaries, OAuth).

## Left out on purpose
`node_modules`, build output, generated modules, large fixture JSON, screenshots, old acceptance rounds, and anything secret. Generated files such as `src/ledger/generated-*.ts` are not in this snapshot, so the TypeScript will not compile here.

## What to keep in mind when reviewing
- Artifacts are **untrusted callers**: every rule is enforced on the server.
- Unknown is NULL, never zero. A miss only comes from an explicit `not_done`. Retries reuse the same `client_op_id`. Erasure is hard erasure with an all-NULL stub.
- Separate what you read in the code from what you infer. Nothing here has been tested against real data.
