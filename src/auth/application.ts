import { AuthorizationError, CimdFetchError, OAuthError, OAuthProvider, authorizationErrorRedirect, insufficientScope } from '@cloudflare/workers-oauth-provider'
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider'
import { z } from 'zod'
import type { AuthenticatedIdentity } from '../contracts/store'
import type { WorkerBindings } from '../worker/config'
import { readConfig } from '../worker/config'
import { serveMcp } from '../mcp/server'
import { ACCESS_TTL_SECONDS, AUTH_SCOPES, REFRESH_TTL_SECONDS, readAuthConfig } from './config'
import type { AuthConfig } from './config'
import { accessAuthorizeUrl, ownerSubject, verifyAccess } from './access-oidc'
import type { FetchLike } from './access-oidc'
import { ConsentDestinationError, consentPage } from './consent'
import { admit, claim, track, transactionFailure } from './guards'
import { AuthFailure, boundedText, json, randomToken, redirect } from './http'

interface ProviderEnvironment extends WorkerBindings { OAUTH_KV: KVNamespace; OAUTH_PROVIDER?: OAuthHelpers }
export type AuthenticatedHandler = (request: Request, env: WorkerBindings, ctx: ExecutionContext,
  identity: AuthenticatedIdentity, scopes: readonly string[]) => Promise<Response>
const propsSchema = z.strictObject({ subject: z.string().regex(/^[a-f0-9]{64}$/), deploymentId: z.string(),
  authorizationIssuedAt: z.number().int().nonnegative() })
const upstreamSchema = z.strictObject({ verifier: z.string().min(43).max(128), nonce: z.string().min(43).max(128) })

function checkScopes(scopes: readonly string[]): void {
  if (scopes.some(scope => !AUTH_SCOPES.includes(scope))) throw new AuthFailure('invalid_scope')
}

async function transaction<T>(config: AuthConfig, kind: 'consent' | 'upstream', key: string, operation: () => Promise<T>): Promise<T> {
  try { return await operation() }
  catch (error) {
    if (error instanceof AuthorizationError && !error.redirectTo) throw new AuthFailure(await transactionFailure(config, kind, key))
    throw error
  }
}

async function browserRoute(request: Request, env: ProviderEnvironment, config: AuthConfig, fetcher: FetchLike): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER
  if (!oauth) return json({ error: 'server_error' }, 503)
  const url = new URL(request.url)
  if (url.pathname === '/oauth/authorize' && request.method === 'GET') {
    const auth = await oauth.parseAuthRequest(request)
    if (!auth.codeChallenge || auth.codeChallengeMethod !== 'S256') throw new AuthFailure('pkce_required')
    checkScopes(auth.scope)
    if (auth.scope.length === 0) auth.scope = ['lts']
    const description = await oauth.describeConsent(auth)
    const consent = await oauth.beginConsent(auth)
    await track(config, 'consent', consent.handle)
    return consentPage(description, consent.handle, consent.headers, {
      accessAuthorizationUrl: config.ACCESS_AUTHORIZATION_URL, clientRedirectUri: auth.redirectUri
    })
  }
  if (url.pathname === '/oauth/authorize' && request.method === 'POST') {
    const form = await request.formData()
    if (form.getAll('handle').length !== 1 || form.getAll('decision').length !== 1 ||
      [...form.keys()].some(key => !['handle', 'decision'].includes(key))) throw new AuthFailure('invalid_consent')
    const parsed = z.strictObject({ handle: z.string().min(1).max(512), decision: z.enum(['approve', 'deny']) })
      .safeParse({ handle: form.get('handle'), decision: form.get('decision') })
    if (!parsed.success) throw new AuthFailure('invalid_consent')
    const input = parsed.data
    if (input.decision === 'deny') {
      const denied = await transaction(config, 'consent', input.handle, () => oauth.denyConsent(request, input.handle))
      if (!await claim(config, 'consent', input.handle)) throw new AuthFailure(await transactionFailure(config, 'consent', input.handle))
      return redirect(denied.redirectTo, denied.headers)
    }
    const approved = await transaction(config, 'consent', input.handle, () => oauth.approveConsent(request, input.handle))
    checkScopes(approved.request.scope)
    if (!await claim(config, 'consent', input.handle)) throw new AuthFailure(await transactionFailure(config, 'consent', input.handle))
    const verifier = randomToken()
    const nonce = randomToken()
    const upstream = await oauth.beginUpstream(approved.request, { data: { verifier, nonce }, headers: approved.headers })
    await track(config, 'upstream', upstream.state)
    return redirect(await accessAuthorizeUrl(config, upstream.state, verifier, nonce), upstream.headers)
  }
  if (url.pathname === '/oauth/callback' && request.method === 'GET') {
    const state = url.searchParams.get('state') ?? ''
    const resumed = await transaction(config, 'upstream', state, () => oauth.finishUpstream(request))
    if (!await claim(config, 'upstream', state)) throw new AuthFailure(await transactionFailure(config, 'upstream', state))
    try {
      if (url.searchParams.has('error')) throw new AuthFailure('identity_denied')
      const code = z.string().min(1).max(2048).parse(url.searchParams.get('code'))
      const data = upstreamSchema.parse(resumed.data)
      const subject = await verifyAccess(config, fetcher, { code, ...data })
      checkScopes(resumed.request.scope)
      const completed = await oauth.completeAuthorization({ request: resumed.request, userId: subject,
        metadata: {}, scope: resumed.request.scope,
        props: { subject, deploymentId: config.DEPLOYMENT_ID, authorizationIssuedAt: Date.now() } })
      return redirect(completed.redirectTo, resumed.headers)
    } catch (error) {
      resumed.headers.set('x-nova-auth-error', error instanceof CimdFetchError ? 'cimd_fetch_failed' :
        error instanceof AuthFailure ? error.code : 'callback_failed')
      return redirect(authorizationErrorRedirect(resumed.request, 'access_denied'), resumed.headers)
    }
  }
  return json({ error: 'not_found' }, 404)
}

function provider(config: AuthConfig, fetcher: FetchLike, handler: AuthenticatedHandler): OAuthProvider<ProviderEnvironment> {
  return new OAuthProvider<ProviderEnvironment>({
    apiRoute: '/mcp', authorizeEndpoint: '/oauth/authorize', tokenEndpoint: '/oauth/token',
    clientRegistrationEndpoint: '/oauth/register', clientIdMetadataDocumentEnabled: true,
    accessTokenTTL: ACCESS_TTL_SECONDS, refreshTokenTTL: REFRESH_TTL_SECONDS,
    scopesSupported: AUTH_SCOPES, requiredScopes: ['lts'],
    resourceMetadata: { resource: `${config.PUBLIC_ORIGIN}/mcp`, authorization_servers: [config.PUBLIC_ORIGIN] },
    apiHandler: { async fetch(request, env, ctx) {
      const props = propsSchema.safeParse(ctx.props)
      const auth = z.object({ token: z.string(), clientId: z.string().min(1).max(2048), userId: z.string(),
        audience: z.literal(`${config.PUBLIC_ORIGIN}/mcp`), scope: z.array(z.string()), expiresAt: z.number() })
        .safeParse('auth' in ctx ? ctx.auth : undefined)
      if (!props.success || !auth.success || props.data.subject !== auth.data.userId ||
        props.data.subject !== await ownerSubject(config) || props.data.deploymentId !== config.DEPLOYMENT_ID ||
        auth.data.expiresAt <= Date.now() / 1000) return json({ error: 'invalid_token' }, 401, {
          'www-authenticate': `Bearer error="invalid_token", resource_metadata="${config.PUBLIC_ORIGIN}/.well-known/oauth-protected-resource/mcp", scope="lts"`
        })
      if (!auth.data.scope.includes('lts')) return insufficientScope(auth.data, ['lts'])
      const dataBindings: WorkerBindings = { CONTROL: env.CONTROL, LEDGER: env.LEDGER, ERASURE: env.ERASURE, DEPLOYMENT_ID: env.DEPLOYMENT_ID,
        ...(env.COMPAT_MODE ? { COMPAT_MODE: env.COMPAT_MODE } : {}) }
      return handler(request, dataBindings, ctx, { subject: props.data.subject, clientId: auth.data.clientId,
        deploymentId: config.DEPLOYMENT_ID }, auth.data.scope)
    } },
    defaultHandler: { fetch: (request, env) => browserRoute(request, env, config, fetcher) },
    clientRegistrationCallback: ({ clientMetadata }) => {
      const valid = z.object({ client_name: z.string().min(1).max(128).optional(),
        redirect_uris: z.array(z.url().max(2048)).min(1).max(4), software_statement: z.never().optional()
      }).safeParse(clientMetadata)
      return valid.success ? undefined : { code: 'invalid_client_metadata' }
    },
    tokenExchangeCallback: async options => {
      const props = propsSchema.safeParse(options.props)
      if (!props.success || props.data.subject !== options.userId || props.data.subject !== await ownerSubject(config) ||
        props.data.deploymentId !== config.DEPLOYMENT_ID) throw new OAuthError('invalid_grant', { description: 'Authorization is no longer valid.' })
      if (options.grantType === 'authorization_code' && (props.data.authorizationIssuedAt > Date.now() ||
        Date.now() - props.data.authorizationIssuedAt >= 10 * 60 * 1000)) {
        throw new OAuthError('invalid_grant', { description: 'Authorization code expired.' })
      }
      if (options.grantType === 'authorization_code' &&
        !await claim(config, 'authorization_code', `${options.userId}:${options.grantId}`)) throw new OAuthError('invalid_grant', { description: 'Authorization code already used.' })
    },
    // Library error details may include client input; return only stable codes.
    onError: ({ code, status, headers, internal }) => {
      const output = new Headers(headers)
      // Keep standard token-endpoint OAuth codes/statuses, with a safe diagnostic
      // for metadata failures. Never expose internal.detail or descriptions.
      if (internal?.category === 'client-id-metadata-document' && internal.reason === 'metadata_resolution_failed') {
        output.set('x-nova-auth-error', 'cimd_fetch_failed')
      }
      return json({ error: code }, status, output)
    }
  })
}

export function createOAuthApplication(fetcher: FetchLike = (url, init) => fetch(url, init),
  handler: AuthenticatedHandler = serveMcp) {
  return {
    async fetch(request: Request, environment: unknown, ctx: ExecutionContext): Promise<Response> {
      const url = new URL(request.url)
      const routing = readConfig(environment)
      const config = readAuthConfig(environment)
      if (url.pathname === '/health' && request.method === 'GET') {
        return routing.ok ? json({ ok: true, service: 'nova', authConfigured: config.ok }) : json(routing, 503)
      }
      if (!config.ok) return json(config, 503)
      if (url.origin !== config.value.PUBLIC_ORIGIN) return json({ error: 'wrong_origin' }, 421)
      if (request.url.length > 8192) return json({ error: 'request_too_large' }, 414)
      try {
        const bucket = url.pathname === '/oauth/register' ? 'register' : url.pathname === '/oauth/authorize' ? 'authorize' :
          url.pathname === '/oauth/token' ? 'token' : url.pathname === '/oauth/callback' ? 'callback' : null
        if (bucket && !await admit(config.value, bucket)) return json({ error: 'rate_limited' }, 429, { 'retry-after': '60' })
        let bounded = request
        if (request.method === 'POST') {
          const body = await boundedText(request.body, url.pathname === '/mcp' ? 512 * 1024 : 16_384)
          bounded = new Request(request, { body })
        }
        return await provider(config.value, fetcher, handler).fetch(bounded, config.value, ctx)
      } catch (error) {
        if (error instanceof AuthorizationError) {
          // Preserve only the validated destination and protocol state/issuer;
          // library descriptions can contain arbitrary client input.
          if (error.redirectUri) return redirect(authorizationErrorRedirect({ redirectUri: error.redirectUri,
            ...(error.state === undefined ? {} : { state: error.state }), ...(error.issuer === undefined ? {} : { issuer: error.issuer }) }, error.code))
          return json({ error: error.code === 'invalid_request' ? 'invalid_authorization_request' : error.code }, 400)
        }
        if (error instanceof CimdFetchError) return json({ error: 'cimd_fetch_failed' }, 400)
        if (error instanceof ConsentDestinationError) return json({ error: error.code }, 400)
        if (error instanceof z.ZodError) return json({ error: 'request_validation_failed' }, 400)
        if (error instanceof AuthFailure) return json({ error: error.code === 'body_too_large' ? 'request_too_large' : error.code }, error.code === 'body_too_large' ? 413 : 400)
        return json({ error: 'temporarily_unavailable' }, 503)
      }
    }
  }
}
