import { z } from 'zod'
import type { AuthConfig } from './config'
import { sha256 } from './http'
import type { AuthFailureCode } from './http'

export async function transactionFailure(config: AuthConfig, kind: 'consent' | 'upstream', key: string): Promise<AuthFailureCode> {
  // The library deliberately conflates missing/used/expired KV records. Consult
  // our existing SQL metadata only for diagnostics; never parse its error text.
  try {
    const control = config.CONTROL.get(config.CONTROL.idFromName('control'))
    const status = await control.authTransactionStatus({ kind, keyHash: await sha256(key) })
    if (status === 'consumed') return kind === 'consent' ? 'consent_replayed' : 'callback_replayed'
    if (status === 'expired') return kind === 'consent' ? 'consent_expired' : 'callback_expired'
  } catch { /* Diagnostic lookup must not replace the original 400 status. */ }
  return kind === 'consent' ? 'invalid_consent' : 'invalid_callback'
}

export async function claim(config: AuthConfig, kind: 'consent' | 'upstream' | 'authorization_code', key: string): Promise<boolean> {
  const control = config.CONTROL.get(config.CONTROL.idFromName('control'))
  const keyHash = await sha256(key)
  return z.boolean().parse(kind === 'authorization_code' ? await control.claimAuthOnce({ kind, keyHash }) :
    await control.authTransaction({ operation: 'consume', kind, keyHash }))
}
export async function track(config: AuthConfig, kind: 'consent' | 'upstream', key: string): Promise<void> {
  const control = config.CONTROL.get(config.CONTROL.idFromName('control'))
  const recorded = z.boolean().parse(await control.authTransaction({ operation: 'register', kind, keyHash: await sha256(key) }))
  if (!recorded) throw new Error('Authorization transaction could not be recorded.')
}
export async function admit(config: AuthConfig, kind: 'register' | 'authorize' | 'token' | 'callback'): Promise<boolean> {
  const control = config.CONTROL.get(config.CONTROL.idFromName('control'))
  return z.boolean().parse(await control.admitAuthRequest(kind))
}
