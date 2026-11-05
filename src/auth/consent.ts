import type { ConsentDescription } from '@cloudflare/workers-oauth-provider'

const escape = (value: string): string => value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`)
export class ConsentDestinationError extends Error {
  readonly code = 'unsupported_redirect_origin'
  constructor() { super('unsupported_redirect_origin') }
}

function cspOrigin(value: string): string {
  const origin = new URL(value).origin
  // Opaque/native schemes have no origin. Reject them instead of granting an
  // entire scheme or emitting "null". Also reject CSP delimiters/wildcard hosts.
  if (!/^https?:\/\/(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::[0-9]+)?$/i.test(origin)) throw new ConsentDestinationError()
  return origin
}

export function consentPage(details: ConsentDescription, handle: string, headers: Headers,
  destinations: { accessAuthorizationUrl: string; clientRedirectUri: string }): Response {
  // Caller supplies configured Access URL and the SDK-validated auth.redirectUri,
  // never raw query/form data or self-asserted client metadata URLs.
  const origins = [...new Set([cspOrigin(destinations.accessAuthorizationUrl), cspOrigin(destinations.clientRedirectUri)])]
  headers.set('content-type', 'text/html; charset=utf-8')
  headers.set('content-security-policy', `default-src 'none'; form-action 'self' ${origins.join(' ')}; frame-ancestors 'none'; base-uri 'none'`)
  headers.set('x-frame-options', 'DENY')
  headers.set('referrer-policy', 'no-referrer')
  headers.set('cache-control', 'no-store')
  const publisher = details.clientDomain ? `Published by ${escape(details.clientDomain)}.` : 'The client name is self-asserted and is not verified.'
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect NOVA</title><h1>Connect ${escape(details.clientName)} to NOVA?</h1>
<p>${publisher}</p><p>Access will be returned to <strong>${escape(details.redirectHost)}</strong>.</p>
${details.redirectIsLoopback ? '<p>This sends access to an app on your computer. Continue only if you just started this sign-in.</p>' : ''}
<p>Requested permissions: ${details.scope.map(escape).join(', ')}. NOVA allows only its configured owner to finish signing in.</p>
<form method="post"><input type="hidden" name="handle" value="${escape(handle)}">
<button name="decision" value="approve">Allow and sign in</button> <button name="decision" value="deny">Deny</button></form></html>`
  return new Response(html, { headers })
}
