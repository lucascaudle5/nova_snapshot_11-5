# ADR 0006: Hosted compatibility provisioning and budget gate

Status: proposed for Lucas's Step 7 review, November 3, 2026.
The domain/login inputs below are Lucas-confirmed; resource creation, publication
and acceptance of the residual budget risk are not approved by this document.

**Decision proposed:** new Worker `nova-compat`, deployment ID `compat`, namespace
`nova-compat-oauth-kv`, Access SaaS OIDC app `NOVA Compat OIDC` and exact callback
`https://nova-compat.lcaudle-nova.workers.dev/oauth/callback`. Use the existing
Google login and One-time PIN backup with a new exact-owner-only policy. Sol
prepares files and checks locally; Lucas or his Cloudflare assistant operates the
account. No account credential is supplied to Sol.

**Decision proposed:** provision fresh KV/Access resources first; deploy the
reviewed Worker and new SQLite class namespaces together in Step 8 with ingress
off. Enter secrets privately, then enable the single approved origin only after
configuration/budget review. A resource manifest cannot create valid DO bindings
to a code-free placeholder. No GitHub auto-deployment or old-resource changes.
Keep the local root Wrangler config local-only; final hosted config needs the
actual assigned non-secret resource IDs before it can be reviewed as deployable.

**Decision proposed:** start with 100 ms CPU/invocation, previews and URL logging/
observability off. These settings passed local Wrangler schema/bundle validation,
not hosted authentication/performance tests. A CPU-limit failure pauses testing
for review; it does not authorize a silent limit increase. Keep usage metrics and
avoid raw request traces containing OAuth codes/state.

**Conceded — Blocker for a strict automatic $10 ceiling:** Workers Paid allocations
are account-wide and shared with old deployments. Cloudflare's alerts notify
after usage thresholds; they do not halt billing. Excess DO duration rounds up
in units that can cost $12.50, already above the remaining $5 allowance. Existing
application rate limits and a CPU/invocation limit cannot guarantee monthly cost.
Lucas must accept supervised usage/shutdown risk or select another mechanism
before public activation; no assumed acceptance from the original $10 direction.
See [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
and [budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/).

**Decision proposed:** account preflight, $1/$3 usage alerts where supported,
review/stop at projected $8 total or 50% of included DO duration consumed; one short
supervised trial before multi-device sessions. Unknown entitlement/usage or any
paid addition blocks creation/publication as specified in the manifest. Alerts,
delayed metrics and manual shutdown do not constitute a hard spending cap.

**Conceded — Major:** new namespace/app IDs, account entitlements, remaining usage,
possible wildcard Access conflicts and hosted CPU/IdP behavior are unverified.
Return only non-secret IDs/endpoints and secret-entry status. Suspend ingress
before rollback; code rollback does not undo SQL/secrets/KV. Destructive cleanup
always needs separate named-resource approval. Backup/restore remains a Phase 1
gate, not something this deployment manifest supplies.

## Step 8 configuration handoff update

Lucas supplied [the non-secret handoff](../CLOUDFLARE_COMPAT_HANDOFF.md) and
requested a closed `wrangler.compat.jsonc`. It reports the new KV/Access IDs,
Workers Paid activation, zero preflight usage, Google/PIN setup and created
$1/$3 alerts. It also explicitly records Lucas accepting costs above the $10
target; the pending strict-cap risk acceptance above is therefore resolved as
reported by Lucas. This is not authorization for Sol to operate the account.

The handoff's default Access session, five-minute upstream token lifetime,
accept-all-current-providers setting, team-domain rename and Google Testing mode
are retained in [the Step 8 preparation report](../acceptance/PHASE0_STEP8_PREPARATION.md).
No IdP validation is relaxed. Public routing/previews stay disabled, secrets
remain private and Step 8 hosted verification is still outstanding.
