import { z } from 'zod'
import { readConfig } from '../worker/config'
import type { WorkerBindings } from '../worker/config'
import { failure } from '../contracts/store'
import type { Result } from '../contracts/store'

const secureUrl = z.url().max(2048).refine(value => {
  const url = new URL(value)
  return url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.search
})
const authSchema = z.object({
  OAUTH_KV: z.custom<KVNamespace>(value => value !== null && typeof value === 'object' &&
    ['get', 'put', 'delete', 'list'].every(key => key in value && typeof Reflect.get(value, key) === 'function')),
  PUBLIC_ORIGIN: z.url().max(2048).refine(value => {
    const url = new URL(value)
    return value === url.origin && (url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
  }),
  ALLOWED_EMAIL: z.email().max(254).transform(value => value.toLowerCase()),
  ACCESS_CLIENT_ID: z.string().min(1).max(256),
  ACCESS_CLIENT_SECRET: z.string().min(1).max(4096),
  ACCESS_ISSUER: secureUrl,
  ACCESS_AUTHORIZATION_URL: secureUrl,
  ACCESS_TOKEN_URL: secureUrl,
  ACCESS_JWKS_URL: secureUrl
}).superRefine((input, context) => {
  const issuer = new URL(input.ACCESS_ISSUER)
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer.hostname) ||
    !/^\/cdn-cgi\/access\/sso\/oidc\/[A-Za-z0-9_-]+$/.test(issuer.pathname) ||
    input.ACCESS_AUTHORIZATION_URL !== `${input.ACCESS_ISSUER}/authorization` ||
    input.ACCESS_TOKEN_URL !== `${input.ACCESS_ISSUER}/token` ||
    input.ACCESS_JWKS_URL !== `${input.ACCESS_ISSUER}/jwks`) {
    context.addIssue({ code: 'custom', message: 'Access endpoints must match the configured issuer.' })
  }
})
export type AuthConfig = z.infer<typeof authSchema> & WorkerBindings
export function readAuthConfig(input: unknown): Result<AuthConfig> {
  const bindings = readConfig(input)
  if (!bindings.ok) return bindings
  const parsed = authSchema.safeParse(input)
  return parsed.success ? { ok: true, value: { ...bindings.value, ...parsed.data } } : failure('configuration_invalid')
}
export const ACCESS_TTL_SECONDS = 24 * 60 * 60
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60
export const AUTH_SCOPES = ['lts', 'offline_access']
