# ADR 0001: Human consent depends on a qualified host path

Status: Accepted by Lucas, November 3, 2026 (D1).

Amends technical design §§7.3, 17, 20 and the fallback wording in §21.

App-only visibility and host approval are trusted-host mechanisms. The server
enforces operation/action/revision binding, expiry, single use and replay rules;
those checks do not independently prove a person clicked. A hidden tool name or
caller-supplied flag is not human-origin evidence.

Measure both discovery and known-name invocation from model text/voice, widget
calls, approval denial/cancellation, and altered-action/replay attempts on each
required host. Record where enforcement occurs and the remaining host dependence.

Use a qualified app-only path, or a qualified host-approval path. If neither
qualifies, forget, reset and promote remain blocked. Do not silently downgrade
them to conversational confirmation. Ordinary self-reports remain ungated and
conversational corrections retain their distinct policy.

No host path has been qualified yet. Actual device evidence is a later gate.
