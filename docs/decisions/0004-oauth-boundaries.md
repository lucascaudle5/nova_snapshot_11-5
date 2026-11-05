# ADR 0004: OAuth boundaries and provider compatibility

Status: implemented locally; awaiting Lucas's Step 5 review. November 3, 2026.

Implements the approved owner-only Access OIDC approach inside the one NOVA
Worker. NOVA is the OAuth authorization/resource server; Cloudflare Access is
the upstream identity provider. Access is not a proxy in front of `/mcp`.

Routes: `/oauth/authorize`, `/oauth/callback`, `/oauth/token` and
`/oauth/register`. The resource/audience is the absolute `${PUBLIC_ORIGIN}/mcp`.
The exact Access redirect URI is `${PUBLIC_ORIGIN}/oauth/callback`. Public
discovery and client registration do not grant data access. Every MCP request
requires a validated bearer, current owner/deployment props and baseline `lts`
scope. The Step 5 server supports initialization; tools/widget enter in Step 6.

Grant only `lts` and optional `offline_access` now. No admin/forget scope or
protected business operation is introduced. All clients, including confidential
clients, must use S256 PKCE. OAuth consent is per client and browser-bound; it
does not qualify a host's app-only or human tool-approval path under ADR 0001.

Set access lifetime to 24 hours and refresh lifetime to a fixed 30 days. The
pinned provider rotates refresh tokens but deliberately accepts the immediately
previous refresh token for lost-response retry until the next token is used
for refresh. Local tests establish that grace and subsequent rejection. Do not
describe this as immediate invalidation on every refresh. Authorization-code
reuse is rejected and can revoke the grant; a lost code-exchange response may
require fresh sign-in. No business operation is retried as part of that flow.

The provider's KV consent/state get-delete is not atomic. Control SQL now tracks
issued browser-transaction hashes with a ten-minute deadline and atomically
consumes them after the provider verifies the browser binding. Validated code
exchange atomically claims a grant identity hash after PKCE/resource checks.
Encrypted grant props carry code issue time, independently enforcing ten-minute
code expiry. Failure after consumption requires a new sign-in, never silent reuse.
Control schema v2 adds only auth metadata/rate tables, not room data.

Provider-owned clients/grants/tokens remain in isolated OAuth KV. These guards
do not make all KV behavior strongly consistent. Local tests do not prove
cross-location revocation propagation or Claude's disconnect behavior; hosted
login, refresh and revocation remain acceptance work. Restoring authority must
still invalidate OAuth KV/grants and Control auth state per design §18.3.

Bound registration to ten requests/minute globally; authorize, callback and token
families to sixty/minute each. Buckets contain no IP/email. This limits application
work, not account-level request billing or availability against public flooding.
OAuth POST bodies are bounded to 16 KiB, MCP envelopes to 512 KiB pending per-tool
limits in Step 6, and IdP JSON to 64 KiB. IdP calls have a ten-second abort signal
and never follow redirects. No raw error, token, email, code, state or upstream
payload is logged. Consent escapes client metadata, shows redirect/scopes and
unverified-client/loopback notices, forbids framing and has no external assets.

CIMD is enabled with `global_fetch_strictly_public`; DCR remains available. No
real client, namespace, credential or Access application was created here. The
local KV declaration omits an account ID. Account values/secrets are supplied
only by Lucas at the later setup gate.

References: pinned provider 1.2.4's installed consent/upstream/authorization docs,
[upstream sign-in](https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/upstream-sign-in.md)
and [authorization reference](https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/authorization-server.md).
Tests, rather than moving upstream documentation, establish this version's
observed local behavior.
