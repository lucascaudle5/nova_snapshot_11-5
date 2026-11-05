import type { AuthenticatedIdentity, ResolvedStore } from '../contracts/store'
import type { WorkerBindings } from '../worker/config'
import { shellOpenSchema, navigateSchema, pollSchema } from '../contracts/navigation'
import { resolveView } from '../contracts/rooms'
import { openStore, resolveStore } from '../worker/store-routing'
import { sha256 } from '../auth/http'

const scopeFor = (identity: AuthenticatedIdentity, route: ResolvedStore) =>
  sha256(JSON.stringify([identity.subject, identity.clientId, route.logicalName, route.physicalId, route.generation, route.deploymentId]))

export async function invokeShell(env: WorkerBindings, identity: AuthenticatedIdentity, input: unknown) {
 const parsed = shellOpenSchema.safeParse(input)
 if (!parsed.success) return { kind: 'shell' as const, ok: false, code: 'invalid_input', initial_view: { room: 'home' } }
 const opened = await openStore(env, identity, parsed.data.store)
 if (!opened.ok) return { kind: 'shell' as const, ...opened, initial_view: { room: parsed.data.room ?? 'home', ...(parsed.data.section ? { section: parsed.data.section } : {}) } }
 const route = resolveView(parsed.data.room, parsed.data.section)
 const resolved: ResolvedStore = opened.value.store
 return { kind: 'shell' as const, ...route, polling_scope: await scopeFor(identity, resolved),
   value: { store: resolved.logicalName, store_handle: opened.value.handle, generation: resolved.generation } }
}

export async function invokeNavigation(env: WorkerBindings, identity: AuthenticatedIdentity, method: 'navigate' | 'poll', input: unknown) {
 const parsed = (method === 'navigate' ? navigateSchema : pollSchema).safeParse(input)
 if (!parsed.success) return { ok: false as const, code: 'invalid_input' }
 try {
  const args = parsed.data
  const resolved = await resolveStore(env, identity, args.store_handle)
  if (!resolved.ok) return resolved
  const route = resolved.value
  const scope = await scopeFor(identity, route)
  const control = env.CONTROL.get(env.CONTROL.idFromName('control'))
  if (method === 'navigate') {
   const target = resolveView('room' in args ? args.room : 'home', 'section' in args ? args.section : undefined)
   const initial = target.initial_view
   const result = await control.navigation({ scope, method, ...initial })
   return { ok: true as const, sequence: result.sequence, delivered: result.delivered, ...(target.ok ? {} : { code: target.code, built_rooms: target.built_rooms }),
    ...(!result.delivered ? { launch_hint: `Call nova.open with room ${initial.room}; it opens one new card.` } : {}) }
  }
  const card = pollSchema.parse(args)
  const result = await control.navigation({ scope, method, card_id: card.card_id, last_seen_sequence: card.last_seen_sequence })
  return { ok: true as const, sequence: result.sequence, active: result.active, view: result.view, data_cursor: 0 }
 } catch { return { ok: false as const, code: 'storage_unavailable' } }
}
