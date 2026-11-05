import { z } from 'zod'
import type { AuthenticatedIdentity } from '../contracts/store'
import type { WorkerBindings } from '../worker/config'
import { readConfig } from '../worker/config'
import { assertWritesEnabled, checkRate, resolveStoreForTools } from './guards'
import type { EraseReceipt } from '../erasure/erasure-types'

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const targetSchema = z.string().regex(uuidV4)
export const erasePlanSchema = z.strictObject({ contract_version: z.literal('erase-1'), targets: z.array(targetSchema).min(1).max(200) })
export const eraseSchema = z.strictObject({ contract_version: z.literal('erase-1'), client_op_id: z.string().regex(uuidV4),
  plan_hash: z.string().regex(/^[0-9a-f]{64}$/), targets: z.array(targetSchema).min(1).max(200),
  decisions: z.array(z.strictObject({ root_id: targetSchema, action: z.enum(['erase', 'retain_nonrevealing']) })).max(200),
  confirm: z.literal('ERASE') })
export const eraseStatusSchema = z.strictObject({ contract_version: z.literal('erase-1'), client_op_id: z.string().regex(uuidV4) })

type Failure = { ok: false; code: string }
type EraseStatusReply = EraseReceipt | Failure
function sizeOkay(input: unknown): boolean {
  try { return new TextEncoder().encode(JSON.stringify(input) ?? '').byteLength <= 64 * 1024 }
  catch { return false }
}
function invalid(): Failure { return { ok: false, code: 'invalid_params' } }

async function open(env: WorkerBindings, identity: AuthenticatedIdentity) {
  const resolved = await resolveStoreForTools(env, identity)
  if (!resolved.ok) return null
  return { route: resolved.route, ledger: env.LEDGER.get(env.LEDGER.idFromName(resolved.route.physicalId)) }
}

export async function invokeErasePlan(env: WorkerBindings, identity: AuthenticatedIdentity, input: unknown) {
  if (!sizeOkay(input)) return { ok: false as const, code: 'invalid_request' }
  const parsed = erasePlanSchema.safeParse(input)
  if (!parsed.success) return invalid()
  const config = readConfig(env)
  if (!config.ok) return { ok: false as const, code: 'storage_unavailable' }
  const rate = await checkRate(env, identity, 'nova.erase_plan', config.value.NOVA_READ_RATE_PER_MIN)
  if (!rate.ok) return rate.code === 'rate_limited' ? rate : { ok: false as const, code: 'storage_unavailable' }
  try {
    const opened = await open(env, identity)
    if (!opened) return { ok: false as const, code: 'storage_unavailable' }
    return await opened.ledger.erasePrepare(opened.route, { targets: parsed.data.targets })
  } catch { return { ok: false as const, code: 'storage_unavailable' } }
}

export async function invokeErase(env: WorkerBindings, identity: AuthenticatedIdentity, input: unknown) {
  const enabled = assertWritesEnabled(env)
  if (!enabled.ok) return enabled.code === 'writes_disabled' ? enabled : { ok: false as const, code: 'storage_unavailable' }
  if (!sizeOkay(input)) return { ok: false as const, code: 'invalid_request' }
  const parsed = eraseSchema.safeParse(input)
  if (!parsed.success) return invalid()
  const config = readConfig(env)
  if (!config.ok) return { ok: false as const, code: 'storage_unavailable' }
  const rate = await checkRate(env, identity, 'nova.erase', config.value.NOVA_WRITE_RATE_PER_MIN)
  if (!rate.ok) return rate.code === 'rate_limited' ? rate : { ok: false as const, code: 'storage_unavailable' }
  try {
    const opened = await open(env, identity)
    if (!opened) return { ok: false as const, code: 'storage_unavailable' }
    return await opened.ledger.eraseExecute(opened.route, { client_op_id: parsed.data.client_op_id,
      plan_hash: parsed.data.plan_hash, targets: parsed.data.targets, decisions: parsed.data.decisions })
  } catch { return { ok: false as const, code: 'storage_unavailable' } }
}

export async function invokeEraseStatus(env: WorkerBindings, identity: AuthenticatedIdentity, input: unknown): Promise<EraseStatusReply> {
  if (!sizeOkay(input)) return { ok: false as const, code: 'invalid_request' }
  const parsed = eraseStatusSchema.safeParse(input)
  if (!parsed.success) return invalid()
  const config = readConfig(env)
  if (!config.ok) return { ok: false as const, code: 'storage_unavailable' }
  const rate = await checkRate(env, identity, 'nova.erase_status', config.value.NOVA_READ_RATE_PER_MIN)
  if (!rate.ok) return rate.code === 'rate_limited' ? rate : { ok: false as const, code: 'storage_unavailable' }
  try {
    const opened = await open(env, identity)
    if (!opened) return { ok: false as const, code: 'storage_unavailable' }
    return opened.ledger.eraseStatus(opened.route, { client_op_id: parsed.data.client_op_id })
  } catch { return { ok: false as const, code: 'storage_unavailable' } }
}
