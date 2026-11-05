# ADR 0003: Retained foundation, synthetic compatibility scope

Status: Accepted by Lucas, November 3, 2026 (D3).

Use one private npm package with TypeScript/Preact, MCP SDK v2, Cloudflare's
Vitest plugin and Playwright. The eventual compatibility surface is one launcher
and resource plus sandbox-only helpers. Synthetic data only; Fitness persistence,
backup/restore and migration are Phase 1 or later gates.

Step 2 sets up packages, lockfile, Node pin, strict types, lint, local test
configuration and ignores. Its executable compatibility checks are test fixtures,
not a deployed Worker, production auth or an implemented widget. CI is step 3;
production bindings are step 4. Stop for Lucas's review after every numbered step.

Visual direction for Phase 1 is `nova-standalone.html` and `nova-site.zip`/`logos/`:
cream cards, sky-blue gradient, Fraunces/Outfit, green handprint, dark Second Voice
card. Keep widget tokens in one stylesheet; the compatibility placeholder does
not require a full visual implementation or remote font requests.

Device model/OS/version fields stay placeholders for iPhone, iPad and Windows
until Lucas supplies them at the device steps. `prompts/` belongs to Lucas and
must remain untouched.

Step 4 update: Lucas supplied and committed `docs/acceptance/DEVICES.md`.
Use that inventory and recheck versions when testing. The Windows web-host target
is claude.ai in Chrome, replacing Edge. Inventory is not host-acceptance evidence.
