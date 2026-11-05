import { createLocalJWKSet, jwtVerify } from 'jose'
import type { JWK } from 'jose'
import { z } from 'zod'
import type { AuthConfig } from './config'
import { AuthFailure, boundedText, pkceChallenge, sha256 } from './http'

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>
export const callbackUrl = (config: AuthConfig): string => `${config.PUBLIC_ORIGIN}/oauth/callback`
export const ownerSubject = (config: AuthConfig): Promise<string> =>
  sha256(`nova-owner:${config.DEPLOYMENT_ID}:${config.ALLOWED_EMAIL}`)

export async function accessAuthorizeUrl(config: AuthConfig, state: string, verifier: string, nonce: string): Promise<string> {
  const url = new URL(config.ACCESS_AUTHORIZATION_URL)
  for (const [key, value] of Object.entries({ response_type: 'code', client_id: config.ACCESS_CLIENT_ID,
    redirect_uri: callbackUrl(config), scope: 'openid email', state, nonce,
    code_challenge: await pkceChallenge(verifier), code_challenge_method: 'S256' })) url.searchParams.set(key, value)
  return url.toString()
}

const keyMetadata = { kid: z.string().max(256).optional(), alg: z.enum(['RS256', 'ES256']).optional(),
  use: z.literal('sig').optional(), d: z.never().optional() }
const keyPart = z.string().min(1).max(16_384)
const keysSchema = z.object({ keys: z.array(z.discriminatedUnion('kty', [
  z.object({ ...keyMetadata, kty: z.literal('RSA'), n: keyPart, e: keyPart }),
  z.object({ ...keyMetadata, kty: z.literal('EC'), crv: z.literal('P-256'), x: keyPart, y: keyPart })
])).min(1).max(10) })
const claimsSchema = z.object({
  sub: z.string().min(1).max(256), email: z.email().max(254), email_verified: z.boolean().optional(),
  nonce: z.string().min(1).max(256), exp: z.number().int(), iat: z.number().int(),
  aud: z.union([z.string(), z.array(z.string()).min(1)]), azp: z.string().optional()
})

export async function verifyAccess(config: AuthConfig, fetcher: FetchLike,
  input: { code: string; verifier: string; nonce: string }): Promise<string> {
  const signal = AbortSignal.timeout(10_000)
  async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
    const response = await fetcher(url, { ...init, signal, redirect: 'manual' })
    if (!response.ok) throw new AuthFailure('identity_upstream_failed')
    const text = await boundedText(response.body, 65_536)
    try { const parsed: unknown = JSON.parse(text); return parsed }
    catch { throw new AuthFailure('invalid_identity_response') }
  }
  const tokens = z.object({ id_token: z.string().min(1).max(32_768) }).parse(await fetchJson(config.ACCESS_TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: input.code,
      redirect_uri: callbackUrl(config), client_id: config.ACCESS_CLIENT_ID,
      client_secret: config.ACCESS_CLIENT_SECRET, code_verifier: input.verifier })
  }))
  const jwks = keysSchema.parse(await fetchJson(config.ACCESS_JWKS_URL, { headers: { accept: 'application/json' } }))
  const keys = jwks.keys.map(key => {
    const publicKey: JWK = key.kty === 'RSA' ? { kty: key.kty, n: key.n, e: key.e } :
      { kty: key.kty, crv: key.crv, x: key.x, y: key.y }
    if (key.kid !== undefined) publicKey.kid = key.kid
    if (key.alg !== undefined) publicKey.alg = key.alg
    if (key.use !== undefined) publicKey.use = key.use
    return publicKey
  })
  const verified = await jwtVerify(tokens.id_token, createLocalJWKSet({ keys }), {
    issuer: config.ACCESS_ISSUER, audience: config.ACCESS_CLIENT_ID, algorithms: ['RS256', 'ES256'],
    requiredClaims: ['exp', 'iat', 'sub', 'email', 'nonce'], maxTokenAge: '10m', clockTolerance: 0
  })
  const claims = claimsSchema.parse(verified.payload)
  if (claims.nonce !== input.nonce || claims.email.toLowerCase() !== config.ALLOWED_EMAIL ||
    claims.email_verified === false || (claims.azp !== undefined && claims.azp !== config.ACCESS_CLIENT_ID) ||
    (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== config.ACCESS_CLIENT_ID)) {
    throw new AuthFailure('identity_rejected')
  }
  return ownerSubject(config)
}
