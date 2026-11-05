export type AuthFailureCode = 'invalid_scope' | 'pkce_required' | 'invalid_consent' | 'consent_replayed' | 'consent_expired' |
  'invalid_callback' | 'callback_replayed' | 'callback_expired' | 'identity_denied' | 'identity_upstream_failed' |
  'invalid_identity_response' | 'identity_rejected' | 'body_too_large' | 'invalid_encoding'
export class AuthFailure extends Error {
  readonly code: AuthFailureCode
  constructor(code: AuthFailureCode) { super(code); this.code = code }
}
export const json = (data: unknown, status = 200, headers?: HeadersInit): Response => {
  const output = new Headers(headers)
  output.set('cache-control', 'no-store')
  output.set('referrer-policy', 'no-referrer')
  return Response.json(data, { status, headers: output })
}
export function redirect(location: string, headers = new Headers()): Response {
  headers.set('location', location)
  headers.set('cache-control', 'no-store')
  headers.set('referrer-policy', 'no-referrer')
  return new Response(null, { status: 302, headers })
}
export async function boundedText(body: ReadableStream<Uint8Array> | null, limit: number): Promise<string> {
  if (!body) return ''
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      total += chunk.value.byteLength
      if (total > limit) { await reader.cancel(); throw new AuthFailure('body_too_large') }
      chunks.push(chunk.value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
  catch { throw new AuthFailure('invalid_encoding') }
}
export async function sha256(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
    byte => byte.toString(16).padStart(2, '0')).join('')
}
export function randomToken(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}
export async function pkceChallenge(verifier: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  return btoa(String.fromCharCode(...hash)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}
