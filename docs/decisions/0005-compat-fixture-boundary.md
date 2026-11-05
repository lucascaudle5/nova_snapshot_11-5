# ADR 0005: Synthetic compatibility actions and recovery

Status: implemented for Lucas's Step 6 review, November 3, 2026.
Applies to Phase 0 only; ADR 0001 governs host trust.

**Decision:** `compat.open` is the launcher, with explicit `real|sandbox`, contract
`compat-1` and optional existing handle. Reopening validates the existing target;
it never retargets or renews an expired operation. A new view gets a UUID session
for correlation, not authentication or proof of a Claude conversation.

**Decision:** the five probe helpers exist only when both the Worker catalog and
the Ledger are configured with `COMPAT_MODE=synthetic-only`. Mutations require a
freshly resolved sandbox handle; real exposes synthetic read-only status. There
are no forget/reset/promote implementations. Disabling the flag removes helpers
and rejects internal fixture calls; it is not a production readiness switch.

**Decision:** the canonical hash covers contract, authenticated owner/client,
deployment, physical Ledger, generation, operation ID, policy, delta and target
revision. It excludes handle strings and view sessions. The operation key is
owner/client plus operation ID within that physical Ledger. Identical authorized
retries through another handle for the same store/generation return the original
receipt; changed action conflicts. This implements plan R8's preferred rule for
synthetic probes. Its adoption for real writes remains a Phase 1 review gate.

**Decision:** `none` prepares and commits immediately; `conversational` prepares
then uses `compat.continue`; `human` prepares then uses app-only `app.confirm`.
Pending evidence lasts five minutes without extension on retries. Receipt and
fixture update share a synchronous SQLite transaction. Revision, local gates,
expiry and action binding are checked before a pending action is consumed.
Completed receipts replay even after evidence expiry, after fresh authorization.
The fixture retains at most 256 operation records per physical sandbox; it then
refuses new actions while reads/receipts remain available. No automatic pruning,
reset or generation-changing helper is exposed.

**Conceded:** action hashes are public binding data, not human-origin secrets.
Local protocol tests deliberately demonstrate that an authenticated known-name
call can reach `app.confirm`. `host_dependent_app` means that wrapper was used,
not that the server proved a click. `model_reported` is similarly honest about
conversational evidence. H1/H2 must qualify an actual trusted host path; protected
real operations remain unavailable if neither path qualifies.

**Decision:** uncertain widget submissions retain the exact ID/payload and query
the receipt before any resend. Best-effort session storage is scoped by original
session/handle; storage denial falls back to memory with a visible limitation.
Corrupt recovery metadata blocks fresh actions and is preserved. No bearer or
refresh token enters the widget. Preferences are not an operation journal.

**Conceded:** session storage, background timers, same-origin BroadcastChannel
card election and notification routing are host-dependent. Five-second automatic
refresh runs only while visible, elected and without an unresolved action;
channel denial disables polling and leaves manual Refresh. Separate host origins
can defeat cross-card election, so H5 still must qualify or revise this fallback.
This is not durable offline capture, the Phase 1 common write pipeline, or the
freeze/capture/restore protocol. Those gates remain open.


November 4 host-run correction: the compat launcher is `compat.open` and its
resource is `ui://nova/compat/compat-1.html`, avoiding the old LTS/Ink names.
Pending operations past expires_at return derived `expired` from receipt reads;
this never rewrites a receipt or extends evidence lifetime. Late confirmation
still rejects, and committed receipts continue to replay after expiry. Widget
Discard is available only after server-established expiry and removes only local
pending metadata. A fresh Prepare uses a new UUID. Host theme takes priority over
system color preference; attribution and restart-recovery policies above remain.


## November 4 follow-up: bounded mount recovery (option 3)

Lucas selected option 3 after hosted findings 13/16. Add app-only, read-only
`compat.recover` with the strict base input (contract_version, store_handle,
session_id). The catalog advertises it only with COMPAT_MODE=synthetic-only;
the service and Ledger independently require that mode and a resolved sandbox.
Real, stale handles/generations and mismatched owner/client reject. Actor remains
the hash of authenticated subject/client; caller-supplied actor or limit rejects.

Recovery adds optional `unresolved_operations` to the shared view/fixture result:
at most five distinct pending/expired operation records, never committed records.
It is present on recovery results only; other tool response shapes remain the
same. No contract/action-hash change or database migration is needed. Existing
compat_operations is already capped at 256 rows. Query filters actor before the
fixed LIMIT 5, ordered by rowid descending (newest first prepare); retry/upsert
never moves an operation to the front. Expiry is derived from one server-clock
snapshot, with no receipt, counter, revision, event or lifetime mutation.

On each mount/new view scope the widget performs recovery after bridge and view
are available, before allowing prepares. An uncertain local submission without a
receipt still resolves its exact ID first, rather than discovering another action.
Otherwise even a host-replayed known operation is checked against discovery: zero
results means no box; one restores it; two or more require an explicit Select.
No discovery, selection or local Discard writes to the server. Denied/invalid
recovery has a visible Retry recovery control and cannot unlock new prepares.
Late replies cannot replace a newer view; tool notifications cannot silently
select from an existing list. Confirm remains app-only and checks its exact
prepared action/hash through the unchanged consent path.

Discard remains local: an expired operation can reappear on a later mount.
Recovery is bounded discovery, not a durable journal or server dismissal system;
older operations beyond the first five remain available by exact-ID receipt.
Host approvals, connector cache refresh, partitioning and mount lifecycle still
need device qualification. Finding 9 attribution is unchanged.

Fullscreen now resets the widget's own scroll on mount/entry, uses viewport-fit
cover, and adds the maximum of host/CSS top insets and a 48px fullscreen gutter
to normal top spacing. The widget cannot control a host's outer chat scroll.
A verified committed receipt sets a last-action time/revision line; it survives
refresh and same-scope notifications until next prepare, and clears on changing
view scope. It is current-card evidence, not persisted committed-history recovery.


## Round 1.5 transport addendum — local only

ADR 0008 supersedes the resource metadata portion of the earlier launcher
pattern: only nova.open carries ui://nova/shell/shell-1.html. Legacy compat.open
returns a short text receipt and no card. compat.read/compat.receipt are app-only
detailed reads, like compat.recover; app.confirm stays app-only. New navigate
(model-visible) and view.poll (app-only) use the scoped Control mailbox, not
compat action storage. Consent, expiry, attribution and sandbox boundaries are
unchanged. See docs/design/ROUND15_ACCEPTANCE.md for the Step 6 follow-up specs
and DESIGN_STATUS.md for local evidence and pending H5 measurements. Earlier
host failures and unverified results remain the evidence of record.
