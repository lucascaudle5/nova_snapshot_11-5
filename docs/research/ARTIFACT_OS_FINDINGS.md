# Claude artifact personal OS — findings (checked 2026-11-05)

## Executive summary

1. A personal data system with an LLM-generated UI, structured backend, and voice is plausible; no exact prior-art system matching the brief was found.
2. Claude currently documents artifact MCP calls on web and desktop, including first-use approval and remembered per-artifact preferences; mobile support is not documented there.
3. MCP supports `structuredContent` and output schemas; MCP Apps pass structured results to embedded views, but Claude artifact-page access to them is unconfirmed.
4. Anthropic’s artifact docs set published-artifact storage at 20 MB, text only; unpublishing deletes that storage.
5. Claude publishes no public limits found for connector tool count, tool-description length, timeouts, result size, or concurrent calls; MCP itself sets no universal caps for these.
6. Prompt-injection robustness has improved in Anthropic evaluations, but measured failures remain; those tests are not specific to this personal app or its write tools.
7. Voice transcription and interpretation errors are established interface risks; read-back, validation, idempotency, and receipts are sensible controls.
8. Keep the Worker as the system of record, validate authorization and invariants server-side, and keep durable exports and restore capability.
9. Claude artifact publishing/sharing has distinct privacy modes; published links can be accessible beyond the owner, while connected-app viewers use their own credentials.
10. Recommendation: start with synthetic data and low-risk writes; prove typed result handling, update/backup behavior, and a standalone front-end exit before storing sensitive data.

## 1. Prior art

**Established.** MCP Apps is an open extension for interactive UI components backed by MCP tools; its living spec describes the host forwarding tool results, including structured data, to the view. OpenAI’s Apps SDK likewise lets developers build an MCP-backed app with custom UI, but the interface is developer-built, not generated on demand. Voice-directed data entry and conversational health-data prototypes exist, but they do not establish the exact artifact + personal MCP + voice combination. [MCP Apps spec](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx) (living draft, checked 2026-11-05); [OpenAI Apps SDK help](https://help.openai.com/en/articles/12515353-building-with-the-apps-sdk) (updated 2026-10-30, checked 2026-11-05); [voice health-data pilot](https://pmc.ncbi.nlm.nih.gov/articles/PMC13299244/) (2026, checked 2026-11-05).

**Anecdotal / not found.** The screenshots and usage observations in the brief are first-person evidence, not independently reproducible documentation. I found no public case study of a personal operating system matching all these elements, nor a sourced account of its failure modes.

**Recommendation:** Treat this as a useful prototype direction, not a validated product pattern; keep data portable and assess it with synthetic records first.

## 2. Artifact limits and equivalents

**Established.** Anthropic’s current help page says artifact MCP access is available on Claude web and desktop for Pro, Max, Team, and Enterprise. The first tool interaction prompts for approval; preferences persist for later use of that artifact. The same page documents 20 MB per artifact for published-artifact persistent storage, text-only values, and deletion of associated storage when unpublished. It does not document tool-count, artifact source-size, connector description, tool timeout, response-size, or parallel-call limits. [Claude artifacts help](https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them) (updated “over a week” before 2026-11-05; exact revision date not shown).

**Established.** Claude sharing docs distinguish current artifacts from legacy published chat artifacts. Current shared artifacts require a Claude account; “Anyone with the link” access is still link-based access, and artifacts using connected apps cannot be shared that way. Legacy published chat artifacts can be opened by anyone with the link without an account. The brief’s iOS behavior and connector compatibility are not established by this current MCP availability statement. [Share artifacts](https://support.claude.com/en/articles/9547008-share-artifacts) (updated 2026-11-05; checked 2026-11-05).

**Equivalent.** OpenAI’s Apps SDK is a preview path for custom MCP logic and UI. ChatGPT’s official help says custom MCP apps are web-only; full write/modify MCP is rolling out in beta to Business, Enterprise, and Edu, with Pro limited to read/fetch; capabilities and permission UI may change. Canvas is not documented as an equivalent persistent MCP app surface in these sources. [Apps SDK help](https://help.openai.com/en/articles/12515353-building-with-the-apps-sdk) (updated 2026-10-30); [custom MCP server help](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt) (updated 2026-10-14; dates from page age as of 2026-11-05).

**Anecdotal.** The reported consent reuse, iPad overlay, blocked outbound fetch, and widget cache behavior are host observations in the brief; official docs reviewed do not specify them. “Page calls count against usage” was not found as a separate rule; Anthropic says artifact users’ Claude usage counts against each user’s subscription for AI-powered artifact requests, but that is not a direct statement about MCP calls.

**Recommendation:** Keep the first version to a few compact tools; measure latency and payload limits on each supported host instead of relying on undocumented ceilings.

## 3. Prompt-injection reality check

**Established.** Anthropic’s Claude for Chrome evaluation reports improved attack resistance, but a residual 1.4%–2.4% success rate under its improved-safeguard tests for Opus 4.5, Sonnet 4.5, and Haiku 4.5; Anthropic explicitly says no browser agent is immune. A separate Gray Swan Agent Red Teaming evaluation in the Opus 4.5 system card reports attack success that grows substantially as attackers get more attempts (Opus 4.5: 4.2% at k=10 and 29.7% at k=100 for indirect injection). These are specific benchmarks, not a forecast for this system; neither measures the exact voice, artifact, Worker, and write-authorization setup here. [Anthropic browser defense evaluation](https://www.anthropic.com/research/prompt-injection-defenses) (published 2025-12, checked 2026-11-05); [Opus 4.5 system card](https://assets.anthropic.com/m/64823ba7485345a7/Claude-Opus-4-5-System-Card.pdf) (2025-11, checked 2026-11-05).

**Established.** OWASP recommends least privilege, human approval for high-impact actions, and treating retrieved content as untrusted. OpenAI’s current tool guidance similarly says to check permissions in the application and require application-level approval for high-impact actions. [OWASP LLM Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html) (living page, checked 2026-11-05); [OpenAI programmatic tool calling guidance](https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling) (living page, checked 2026-11-05).

**Recommendation:** Keep read and write scopes narrow; require a server-enforced confirmation/echo for corrections or destructive actions, and preserve backups before real records.

## 4. Page-as-caller risk

**Established.** The MCP Apps spec says tools marked `visibility: ["app"]` are hidden from the agent but callable by apps. That describes MCP Apps-hosted views; it does not prove that Claude artifact pages share identical authorization semantics. The MCP protocol provides tool calls, not proof that a human physically tapped a control. Therefore a generated page should be treated as an untrusted client: authenticate each request, validate every field and revision, authorize per operation, and enforce invariants server-side. [MCP Apps spec](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx) (living draft, checked 2026-11-05); [MCP tools spec](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/draft/server/tools.mdx) (living draft, checked 2026-11-05).

**Recommendation:** Retain the brief’s operation IDs, stale-revision checks, action binding, and server validation; make “human confirmation” a server-verifiable separate step where impact warrants it.

## 5. Voice writes

**Established.** A review of voice interaction with electronic health records reports that unconstrained dictation creates more opportunities for recognition errors, while constrained numeric fields can improve accuracy. A 2026 multimodal health-monitoring pilot describes confirmation and read-back as part of its voice flow, but is small and exploratory. No study located quantifies silent retries or wrong units/dates in Claude voice writes specifically. [EHR voice interaction review](https://pmc.ncbi.nlm.nih.gov/articles/PMC6051768/) (2018); [voice health-data pilot](https://pmc.ncbi.nlm.nih.gov/articles/PMC13299244/) (2026).

**Anecdotal.** The brief reports successful voice-driven writes, but provides no controlled error-rate data.

**Recommendation:** Echo critical values with units/date before commit, validate allowed ranges, return an operation receipt, and make retries idempotent and correctable.

## 6. Sustainability

**Established.** Artifacts can be copied or downloaded for use outside Claude, and artifact persistent storage is host-bound and removed when an artifact is unpublished. OpenAI’s Apps SDK is an MCP-based alternative interface, but is preview/web-only with evolving permissions. The MCP server and database can remain portable if the contract stays host-neutral. [Claude artifacts help](https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them) (updated late Oct/early Nov 2026); [OpenAI Apps SDK help](https://help.openai.com/en/articles/12515353-building-with-the-apps-sdk) (updated 2026-10-30).

**Recommendation:** Keep versioned JSON/CSV exports, tested restore, and a minimal static or standalone UI that calls the same authenticated MCP/backend contract.

## 7. Other reasons this could fail

**Established.** Data portability, operational availability, account/plan eligibility, authentication expiry, schema evolution, privacy leakage through sharing, and unnoticed bad writes are meaningful failure modes. Current Claude docs say connected-app artifact viewers use their own connections; shared storage can be visible to other users. OpenAI’s MCP app docs also warn that server tool changes are not automatically applied to an already approved workspace snapshot. [Claude sharing help](https://support.claude.com/en/articles/9547008-share-artifacts) (updated 2026-11-05); [ChatGPT MCP help](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt) (updated 2026-10-14).

**Not found.** No independent evidence was found that a single-worker SQLite/Durable Objects design is inherently unsuitable for one owner; reliability depends on backups, migration discipline, service availability, and recovery.

**Recommendation:** Add schema-version migrations, a periodic export, and an explicit recovery path before expanding beyond synthetic workout data.

## 8. Result shape

**Established.** MCP tool results may include `structuredContent`, a JSON value that should conform to a declared `outputSchema`; servers should also return serialized JSON in text for backward compatibility. MCP Apps explicitly pass both `content` and `structuredContent` to the embedded view. The currently reviewed Claude artifact docs promise MCP tool connectivity, but do not say whether artifact JavaScript receives `structuredContent` or only text. The brief’s regex parsing report is anecdotal and fits that gap; do not infer its behavior from the MCP Apps extension. MCP’s base spec states no general maximum result size; hosts, transports, proxies, or server limits can impose one. [MCP tools spec](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/draft/server/tools.mdx) (living draft, checked 2026-11-05); [MCP Apps spec](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx) (living draft, checked 2026-11-05); [Claude artifacts help](https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them) (updated late Oct/early Nov 2026).

**Recommendation:** Declare `outputSchema` and include concise JSON in text; test artifact-side access before building UI against structuredContent, and paginate/bound every response.

## 9. Connector limits

**Established.** MCP has no universal maximum tools per server, description length, call timeout, response bytes, or concurrent calls in its core tools spec; clients and servers negotiate capabilities, and implementations set operational limits. Anthropic’s public Claude documentation reviewed here gives no Claude web/desktop/iOS values for those limits. Claude remote MCP connector documentation describes supported text/image results but does not set the limits requested. [MCP tools spec](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/draft/server/tools.mdx) (living draft, checked 2026-11-05); [Anthropic remote MCP guide](https://support.anthropic.com/en/articles/11503834-building-custom-integrations-via-remote-mcp-servers) (living help page, checked 2026-11-05).

**Not found.** No primary source found specifying connector tool-count, description-character, timeout, response-size, or concurrency ceilings for Claude web, desktop, or iOS. MCP Apps on mobile were likewise not documented. Do not treat Claude Code or API limits as Claude-app limits.

**Recommendation:** Keep the connector compact and each call bounded, paginated, fast, and safe under duplicate/concurrent requests; add local timeouts and load tests.

## 10. Persistence and sharing

**Established.** Anthropic documents artifact personal or shared storage for published artifacts, 20 MB per artifact, text-only, and permanent deletion of storage when unpublished. Claude sharing controls include “Only you,” organization, and link/invitation access according to plan and artifact type. Current connected-app artifacts cannot use “Anyone with the link”; legacy published chat artifacts are accessible to anyone with the link and do not require a Claude account. Artifact edits create versions; the help page does not guarantee that a shared URL updates in place or that storage survives republishing/unpublishing. [Claude artifacts help](https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them) (updated late Oct/early Nov 2026); [Share artifacts](https://support.claude.com/en/articles/9547008-share-artifacts) (updated 2026-11-05); [legacy publishing guide](https://support.anthropic.com/en/articles/11649438-prototype-ai-powered-apps-with-claude-artifacts) (legacy help, checked 2026-11-05).

**Anecdotal / not found.** Forum reports disagree about whether published versions retain the same URL; no official guarantee of in-place update identity was found. No announced change or roadmap promise about artifact connector behavior was found in the reviewed official sources.

**Recommendation:** Store canonical data in the Worker, treat artifact storage as disposable UI state, keep the current artifact URL/version under your control, and verify update semantics before relying on it.

## 11. Exit path

**Established.** Claude lets users view/copy/download artifact code. The MCP backend can be called from another MCP-compatible client or a standalone front end, subject to each host’s auth and policy. [Claude artifacts help](https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them) (updated late Oct/early Nov 2026); [MCP introduction](https://www.anthropic.com/news/model-context-protocol) (2024-11-25).

**Recommendation (cost / risk).** Static export: lowest cost, useful for reference, but stale and read-only. Standalone web UI over the same MCP server: moderate build/hosting/auth cost, best portability, but now you own security and maintenance. Native wrapper: highest build/release cost and platform-specific risk, but may preserve voice, offline, and drawing integration best. Keep the API/data model independent so these remain options.

## Contradictions with the two positions

- **Supports both positions:** Current evidence supports the brief’s claim that artifact MCP access exists and the recommendation to keep the server as authority. Prompt-injection resistance improved, supporting “harder”; Anthropic still reports nonzero attack success and says it is not solved, contradicting any reading that attacks “rarely work” as assurance.
- **Contradicts the assumption that a generated page is harmless:** MCP Apps explicitly allow app-only tools to be called from the app UI. That supports the brief’s observed risk, but is not official proof of the same behavior on Claude artifact pages.
- **Qualifies the “one artifact” approach:** Published artifact storage is limited and host-owned; app-connected artifacts cannot be shared with “anyone with the link” under current sharing rules. This favors the recommendation that server storage stays canonical.
- **Privacy correction:** A published legacy artifact link can be opened by anyone who has it and may be discoverable; don’t place sensitive data in it. Current artifacts have more granular sharing but still require correct access settings.
- **Voice and page-originated write reports:** The brief’s reports are plausible but anecdotal; no external source validates the Pencil performance, blocked network behavior, consent persistence, or voice write reliability.

## Open items I could not resolve

- Whether Claude artifact JavaScript receives MCP `structuredContent` directly, and whether that varies by web, desktop, or iOS host.
- Claude host-specific tool-count, description-length, timeout, response-size, and concurrent-call limits.
- Whether connector calls initiated by an artifact have distinct subscription accounting from other artifact/Claude activity.
- Whether Claude artifact pages are supported on iOS for MCP calls, and whether published-page connector behavior matches in-chat artifacts.
- Exact shared artifact URL/version update semantics and whether persistent storage survives an in-place artifact edit.
- No controlled study found for voice-driven personal logging through Claude, particularly duplicate retries, units, and date errors.

---
**Sources used:** 14 distinct URLs. Mutable help/specification pages were checked on 2026-11-05; where a publisher did not expose a precise revision date, that is stated rather than inferred.


