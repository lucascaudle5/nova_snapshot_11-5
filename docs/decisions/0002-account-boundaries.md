# ADR 0002: Lucas owns account setup and deployment

Status: Accepted by Lucas, November 3, 2026 (D2).

Lucas confirmed `lucascaudle5/NOVA` is private and is subscribing to Workers Paid
at $5/month. Total spending should remain under $10/month including usage; Sol
must tell Lucas before work could exceed that ceiling. This is a budget direction,
not a claim that billing or account limits have been configured.

Use new compatibility resources beside the old deployments. Sol does not access
or change Lucas's Cloudflare account. Lucas creates resources himself or through
Cloudflare's assistant. At step 7 Sol supplies a paste-ready resource manifest:
Worker name and exact workers.dev origin, KV namespace names, Access OIDC
application settings and exact callback URL, and secret names. Unknown account
values must be resolved before calling that manifest executable as-is.

Prepare configuration locally; do not reuse old bindings, credentials or grant
databases. Do not touch old resources. Lucas enters secrets privately, never in
chat. No commit or push without asking; approval of the plan is not authorization
to commit, push, deploy or perform account changes.

Step 3 authorization update: Lucas authorized committing acceptance specifications
and checks-only CI to `phase0-setup`. This grants no push, Cloudflare access or
deployment authority; later numbered steps still stop for review.

Step 7 inputs supplied by Lucas: workers.dev subdomain `lcaudle-nova`; Zero Trust
team domain `lcaudle-nova.cloudflareaccess.com`. Google login is already added and
tested according to Lucas; One-time PIN stays enabled as backup. Reuse those
existing login methods without changing their configuration. This does not verify
paid-plan activation, quota headroom, new resource availability or hosted NOVA.
The proposed new names/settings and cost stop conditions are in
[the compatibility manifest](../CLOUDFLARE_COMPAT_SETUP.md). Account-wide usage
alerts are not a hard $10 spending cap; publication awaits that budget review.
