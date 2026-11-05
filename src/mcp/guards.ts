import type { AuthenticatedIdentity, ResolvedStore } from '../contracts/store'
import type { WorkerBindings } from '../worker/config'
import { openStore } from '../worker/store-routing'
import { readConfig } from '../worker/config'

export function assertWritesEnabled(env: WorkerBindings): { ok: true } | { ok: false; code: 'writes_disabled' | 'configuration_invalid' } {
  const config = readConfig(env)
  if (!config.ok) return { ok: false, code: 'configuration_invalid' }
  return config.value.NOVA_WRITES_ENABLED ? { ok: true } : { ok: false, code: 'writes_disabled' }
}

export async function resolveStoreForTools(env: WorkerBindings, identity: AuthenticatedIdentity): Promise<
  { ok: true; route: ResolvedStore } | { ok: false; code: string }
> {
  const config = readConfig(env)
  if (!config.ok) return config
  const opened = await openStore(env, identity, config.value.NOVA_STORE_MODE)
  return opened.ok ? { ok: true, route: opened.value.store } : opened
}

export async function checkRate(env: WorkerBindings, identity: AuthenticatedIdentity, tool: string, limitPerMinute: number): Promise<
  { ok: true } | { ok: false; code: 'rate_limited' | 'storage_unavailable' }
> {
  try {
    const control = env.CONTROL.get(env.CONTROL.idFromName('control'))
    const allowed = await control.checkToolRate({ identity, tool, limit: limitPerMinute })
    return allowed ? { ok: true } : { ok: false, code: 'rate_limited' }
  } catch { return { ok: false, code: 'storage_unavailable' } }
}
