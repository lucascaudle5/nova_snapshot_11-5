import { z } from 'zod'
import { localDateOf } from '../time/chicago'
import { generatedViews } from '../ledger/generated-views'
import type { AuthenticatedIdentity, LogicalStore, ResolvedStore } from '../contracts/store'
import { rooms } from '../contracts/rooms'
import type { WorkerBindings } from '../worker/config'
import { openStore } from '../worker/store-routing'
import { verbs } from './nova-write-service'

export const readVerbs = verbs

export const readConventions = {
  time_zone: 'America/Chicago', week_start: 'sunday', currency: 'USD', unknown: 'null, never zero'
} as const

export const describeInputSchema = z.strictObject({
  room: z.string().max(32).refine(value => rooms.some(room => room.id === value)).optional()
})

const parameterValueSchema = z.union([z.string().max(2_000), z.number().finite()])
const paramsSchema = z.record(z.string().max(80), parameterValueSchema).refine(value => {
  try { return Object.keys(value).length <= 100 && JSON.stringify(value).length <= 16_384 }
  catch { return false }
})

export const readInputSchema = z.strictObject({
  contract_version: z.string().max(32),
  view: z.string().min(1).max(32),
  params: paramsSchema.optional()
})

export const hostCheckInputSchema = z.strictObject({})

export type ReadEnvironment = WorkerBindings
export type ReadToolDeps = { env: ReadEnvironment; identity: AuthenticatedIdentity }

type ReadStore = { route: ResolvedStore }
type ServiceFailure = { ok: false; code: string; detail?: string }

async function openReadStore(env: ReadEnvironment, identity: AuthenticatedIdentity): Promise<ReadStore | ServiceFailure> {
  const mode: LogicalStore = env.NOVA_STORE_MODE === undefined ? 'sandbox' : env.NOVA_STORE_MODE as LogicalStore
  if (mode !== 'sandbox' && mode !== 'real') return { ok: false, code: 'store_unavailable', detail: 'The store is unavailable.' }
  try {
    const opened = await openStore(env, identity, mode)
    if (!opened.ok) return { ok: false, code: 'store_unavailable', detail: 'The store is unavailable.' }
    return { route: opened.value.store }
  } catch { return { ok: false, code: 'store_unavailable', detail: 'The store is unavailable.' } }
}

function invalidParams(detail = 'Input does not match the read-1 contract.') {
  return { ok: false as const, code: 'invalid_params', detail }
}

export async function invokeDescribe(env: ReadEnvironment, identity: AuthenticatedIdentity, input: unknown) {
  const parsed = describeInputSchema.safeParse(input)
  if (!parsed.success) return invalidParams('room must be one of the catalogued rooms.')
  const opened = await openReadStore(env, identity)
  if ('ok' in opened) return opened
  const views = Object.values(generatedViews).filter(view => parsed.data.room === undefined || view.room === parsed.data.room)
    .map(view => ({ id: view.id, room: view.room, title: view.title, answers: view.answers,
      columns: view.columns,
      params: [...view.params, ...(view.supportsLocalDate
        ? [{ name: 'local_date', type: 'TEXT' as const, required: false }]
        : [])]
    }))
  return { ok: true as const, contract_version: 'read-1' as const, views, verbs: [...readVerbs], conventions: readConventions }
}

export async function invokeRead(env: ReadEnvironment, identity: AuthenticatedIdentity, input: unknown) {
  const parsed = readInputSchema.safeParse(input)
  if (!parsed.success || parsed.data.contract_version !== 'read-1') return invalidParams()
  const opened = await openReadStore(env, identity)
  if ('ok' in opened) return opened
  const ledger = env.LEDGER.get(env.LEDGER.idFromName(opened.route.physicalId))
  return ledger.read(opened.route, { view: parsed.data.view,
    ...(parsed.data.params ? { params: parsed.data.params } : {}) })
}

export async function invokeHostCheck(env: ReadEnvironment, identity: AuthenticatedIdentity, input: unknown) {
  if (!hostCheckInputSchema.safeParse(input).success) return invalidParams()
  const opened = await openReadStore(env, identity)
  if ('ok' in opened) return opened
  const sampleStart = performance.now()
  const ledger = env.LEDGER.get(env.LEDGER.idFromName(opened.route.physicalId))
  const sample = await ledger.read(opened.route, { view: 'HAB-01', params: {
    habit_id: '00000000-0000-4000-8000-000000000001', from_date: '2026-01-04', to_date: '2026-01-10', limit: 1
  } })
  const queryMs = Math.max(0, performance.now() - sampleStart)
  if (!sample.ok) return { ok: false as const, code: 'store_unavailable', detail: 'The sample view could not run.' }
  const resultBytes = new TextEncoder().encode(JSON.stringify(sample)).length
  return {
    ok: true as const,
    contract_versions: ['read-1', 'write-1'] as const,
    server_time_utc: new Date().toISOString(),
    local_date: localDateOf(new Date()),
    store_mode: opened.route.logicalName,
    view_count: Object.keys(generatedViews).length,
    query_ms: queryMs,
    result_bytes: resultBytes
  }
}
