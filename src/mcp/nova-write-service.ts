import { z } from 'zod'
import type { AuthenticatedIdentity } from '../contracts/store'
import type { WorkerBindings } from '../worker/config'
import { writeRequestSchema } from '../ledger/write-types'
import type { WriteReply } from '../ledger/write-types'
import { assertWritesEnabled, checkRate, resolveStoreForTools } from './guards'
import { readConfig } from '../worker/config'
import { HOME_ZONE, localDateOf, localDayBounds } from '../time/chicago'

const mcpSourceSchema = z.object({ ref: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  medium: z.enum(['text', 'audio', 'image', 'document', 'web', 'provider_record', 'artifact']),
  original_text: z.string().optional(), artifact_uri: z.string().optional(), extracted_text: z.string().optional(),
  provider: z.string().optional(), external_id: z.string().optional(), locator: z.string().optional(), parent_source: z.string().nullable() }).strict()
const mcpCiteSchema = z.object({ source: z.string().min(1), role: z.enum(['report', 'observation', 'instruction', 'evidence', 'context']) }).strict()
const mcpEnvelopeSchema = z.object({
  event_start_at: z.string().nullable().optional(), event_end_at: z.string().nullable().optional(),
  time_precision: z.enum(['instant', 'interval', 'date', 'approximate', 'unknown']).optional(),
  reported_at: z.string().nullable().optional(), attribution_date: z.string().nullable().optional(),
  time_zone: z.string().nullable().optional(), attribution_basis: z.enum(['user_selected', 'source_supplied', 'derived', 'unknown']).optional()
}).strict()
const mcpWriteCommon = { table: z.string().min(1).max(64), ref: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/).optional(),
  fields: z.record(z.string(), z.unknown()), cites: z.array(mcpCiteSchema), envelope: mcpEnvelopeSchema.optional() }
const mcpWriteItemSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('create'), ...mcpWriteCommon }).strict(),
  z.object({ op: z.enum(['correct', 'revise']), ...mcpWriteCommon, target: z.string().min(1), reason: z.string().min(1) }).strict(),
  z.object({ op: z.enum(['soft_delete', 'restore']), table: mcpWriteCommon.table, ref: mcpWriteCommon.ref,
    target: z.string().min(1), reason: z.string().optional(), cites: z.array(mcpCiteSchema) }).strict()
])
const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export const novaWriteSchema = z.object({ contract_version: z.literal('write-1'), client_op_id: z.string().regex(uuidV4Regex),
  sources: z.array(mcpSourceSchema).max(40).optional(), writes: z.array(mcpWriteItemSchema).min(1).max(50),
  asserted_by: z.enum(['user', 'model']).optional() }).strict()
const clientOpIdSchema = z.string().regex(uuidV4Regex)
export const habitsLogSchema = z.object({
  client_op_id: clientOpIdSchema,
  habit: z.string().min(1).max(256),
  status: z.enum(['done', 'partial', 'not_done', 'unknown']),
  said: z.string().min(1).max(2000),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  quantity: z.number().finite().nonnegative().optional(),
  duration_seconds: z.number().int().nonnegative().optional(),
  reason_code: z.string().optional(),
  reason_text: z.string().optional(),
  context: z.string().optional()
}).strict()
const reasonCode = z.enum(['time','pain_or_health','energy_or_mood','competing_obligation','environment_or_resources','changed_intention','other'])
const exerciseSetSchema = z.object({ exercise: z.string().min(1).max(256), repetitions: z.number().int().nonnegative().optional(), resistance_grams: z.number().finite().nonnegative().optional(), distance_meters: z.number().finite().nonnegative().optional(), duration_seconds: z.number().int().nonnegative().optional(), effort_text: z.string().max(1000).optional() }).strict()
export const bodyLogWorkoutSchema = z.object({ client_op_id: clientOpIdSchema, status: z.enum(['done','partial','not_done','unknown']), said: z.string().min(1).max(2000), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), reason_code: reasonCode.optional(), reason_text: z.string().max(1000).optional(), pain_discomfort_text: z.string().max(2000).optional(), context: z.string().max(2000).optional(), program: z.string().min(1).max(256).optional(), session_key: z.string().min(1).max(256).optional(), sets: z.array(exerciseSetSchema).max(48).default([]) }).strict()
const ratingSchema = z.object({ quality: z.string().min(1).max(256), numeric_value: z.number().finite().optional(), label_value: z.string().min(1).max(256).optional() }).strict().refine(value => (value.numeric_value === undefined) !== (value.label_value === undefined))
export const mindLogEntrySchema = z.object({ client_op_id: clientOpIdSchema, account: z.string().min(1).max(4000), said: z.string().min(1).max(2000), context: z.string().max(2000).optional(), event_time: z.string().datetime({ offset: true }).optional(), time_precision: z.enum(['instant','date','approximate','unknown']).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), ratings: z.array(ratingSchema).min(1).max(48) }).strict()
export const mindLogMedicationUseSchema = z.object({ client_op_id: clientOpIdSchema, medication: z.string().min(1).max(256), use_status: z.enum(['taken','not_taken','partial','unknown']), said: z.string().min(1).max(2000), experience: z.string().max(2000).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict()
export const schedulePlaceSignalSchema = z.object({ client_op_id: clientOpIdSchema, signal_id: z.string().min(1).max(256), title: z.string().min(1).max(256), planned_start_at: z.string().datetime({ offset: true }), planned_end_at: z.string().datetime({ offset: true }), time_zone: z.string().min(1).max(128), kind: z.enum(['activity','free_time','travel','setup','cleanup','transition']), flexibility: z.enum(['fixed','movable','unknown']), said: z.string().min(1).max(2000), decision_reason: z.string().max(1000).optional() }).strict()
const focusEventTextSchema=z.string().min(1).max(2000)
export const focusStartSessionSchema=z.object({client_op_id:clientOpIdSchema,intention:z.string().min(1).max(1000),reason:z.string().max(2000).optional(),intended_result:z.string().max(1000).optional(),subject_id:z.string().min(1).max(256).optional(),planned_block_id:z.string().min(1).max(256).optional(),configuration:z.string().min(1).max(256).optional(),planned_seconds:z.number().int().positive().optional(),said:z.string().min(1).max(2000),event_time:z.string().datetime({offset:true}).optional(),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()}).strict()
export const focusLogCheckpointSchema=z.object({client_op_id:clientOpIdSchema,session_id:z.string().min(1).max(256),done:focusEventTextSchema.optional(),happened:focusEventTextSchema.optional(),unresolved:focusEventTextSchema.optional(),next:focusEventTextSchema.optional(),event_time:z.string().datetime({offset:true}).optional(),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()}).strict().refine(v=>[v.done,v.happened,v.unresolved,v.next].some(x=>x!==undefined),{path:['done'],message:'at least one checkpoint part is required'})
export const focusEndSessionSchema=z.object({client_op_id:clientOpIdSchema,session_id:z.string().min(1).max(256),outcome:z.enum(['ended','not_done','abandoned','unknown']),reason:z.string().max(2000).optional(),said:z.string().min(1).max(2000),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()}).strict()
export const learningLogPracticeAttemptSchema=z.object({client_op_id:clientOpIdSchema,practice_item_id:z.string().min(1).max(256),response_text:z.string().min(1).max(4000),status:z.enum(['started','partial','completed','abandoned','unknown']),ink_document_id:z.string().min(1).max(256).optional(),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()}).strict()
export const learningLogHelpRequestSchema=z.object({client_op_id:clientOpIdSchema,subject_id:z.string().min(1).max(256),mode:z.enum(['hint','explanation','question','worked_example','full_solution','discussion']),request_text:z.string().min(1).max(4000),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()}).strict()
export const musicLogInterpretationSchema=z.object({client_op_id:clientOpIdSchema,track:z.string().min(1).max(256),interpretation:z.string().min(1).max(4000),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()}).strict()
export const verbs = [
  { name: 'habits.log', room: 'habits', summary: 'Record a reported habit performance using the user’s words as evidence.' },
  { name: 'body.log_workout', room: 'body', summary: 'Record one reported workout and its reported exercise sets atomically.' },
  { name: 'mind.log_entry', room: 'mind', summary: 'Record a reported Mind entry and one or more scale-checked ratings atomically.' },
  { name: 'mind.log_medication_use', room: 'mind', summary: 'Record a reported medication use status and optional experience.' },
  { name: 'schedule.place_signal', room: 'schedule', summary: 'Place an open Schedule signal into one adopted block atomically.' },
  { name: 'focus.start_session', room: 'focus', summary: 'Start a Focus session with its sourced start event.' },
  { name: 'focus.log_checkpoint', room: 'focus', summary: 'Record one or more sourced checkpoint updates for a Focus session.' },
  { name: 'focus.end_session', room: 'focus', summary: 'Record a sourced Focus session outcome.' },
  { name: 'learning.log_practice_attempt', room: 'learning', summary: 'Record a learner supplied practice response and status.' },
  { name: 'learning.log_help_request', room: 'learning', summary: 'Record a learner supplied help request without generating a response.' },
  { name: 'music.log_interpretation', room: 'music', summary: 'Record the owner’s interpretation of a track as user asserted.' },
] as const
export type ToolWriteReply = WriteReply | { ok: false; code: 'invalid_params' | 'writes_disabled' | 'rate_limited' | 'habit_not_found' | 'ambiguous_habit'; candidates?: { id: string; name: string }[]; field?: string }

export async function invokeWrite(env: WorkerBindings, identity: AuthenticatedIdentity, input: unknown): Promise<ToolWriteReply> {
  const enabled = assertWritesEnabled(env)
  if (!enabled.ok) {
    if (enabled.code === 'writes_disabled') return { ok: false, code: 'writes_disabled' }
    return { ok: false, code: 'storage_unavailable' }
  }
  try { if (new TextEncoder().encode(JSON.stringify(input) ?? '').byteLength > 256 * 1024) return { ok: false, code: 'too_large' } }
  catch { return { ok: false, code: 'invalid_request' } }
  const parsed = novaWriteSchema.safeParse(input)
  if (!parsed.success) {
    const version = typeof input === 'object' && input !== null ? (input as { contract_version?: unknown }).contract_version : undefined
    return { ok: false, code: version !== undefined && version !== 'write-1' ? 'invalid_params' : 'invalid_request' }
  }
  const { asserted_by = 'user', ...registryInput } = parsed.data
  const request = writeRequestSchema.safeParse(registryInput)
  if (!request.success) return { ok: false, code: 'invalid_request' }
  const config = readConfig(env)
  if (!config.ok) return { ok: false, code: 'storage_unavailable' }
  const rate = await checkRate(env, identity, 'nova.write', config.value.NOVA_WRITE_RATE_PER_MIN)
  if (!rate.ok) return rate.code === 'rate_limited' ? rate : { ok: false, code: 'storage_unavailable' }
  const resolved = await resolveStoreForTools(env, identity)
  if (!resolved.ok) return { ok: false, code: 'storage_unavailable' }
  try {
    const ledger = env.LEDGER.get(env.LEDGER.idFromName(resolved.route.physicalId))
    return await ledger.write(resolved.route, request.data, { asserted_by, captured_by: 'model' })
  } catch { return { ok: false, code: 'storage_unavailable' } }
}

export async function invokeHabitsLog(env: WorkerBindings, identity: AuthenticatedIdentity, input: unknown): Promise<ToolWriteReply | (Extract<WriteReply, { ok: true }> & { habit: { id: string; name: string }; date: string })> {
  const enabled = assertWritesEnabled(env)
  if (!enabled.ok) {
    if (enabled.code === 'writes_disabled') return { ok: false, code: 'writes_disabled' }
    return { ok: false, code: 'storage_unavailable' }
  }
  const parsed = habitsLogSchema.safeParse(input)
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0]
    return { ok: false, code: 'invalid_params', ...(typeof field === 'string' ? { field } : {}) }
  }
  if ((parsed.data.reason_code !== undefined || parsed.data.reason_text !== undefined) && parsed.data.status !== 'not_done') {
    return { ok: false, code: 'invalid_params', field: 'reason_code' }
  }
  const today = localDateOf(new Date())
  const date = parsed.data.date ?? today
  try { localDayBounds(date) } catch { return { ok: false, code: 'invalid_params', field: 'date' } }
  if (date > today) return { ok: false, code: 'invalid_params', field: 'date' }

  const config = readConfig(env)
  if (!config.ok) return { ok: false, code: 'storage_unavailable' }
  const rate = await checkRate(env, identity, 'habits.log', config.value.NOVA_WRITE_RATE_PER_MIN)
  if (!rate.ok) return rate.code === 'rate_limited' ? rate : { ok: false, code: 'storage_unavailable' }
  const resolved = await resolveStoreForTools(env, identity)
  if (!resolved.ok) return { ok: false, code: 'storage_unavailable' }
  try {
    const ledger = env.LEDGER.get(env.LEDGER.idFromName(resolved.route.physicalId))
    const match = await ledger.resolveHabit(resolved.route, parsed.data.habit)
    if (!match.ok) return { ok: false, code: match.code }
    if (!match.candidates.length) return { ok: false, code: 'habit_not_found' }
    if (match.candidates.length > 1) return { ok: false, code: 'ambiguous_habit', candidates: match.candidates.slice(0, 5).map(({ id, name }) => ({ id, name })) }
    const habit = match.candidates[0]
    if (!habit) return { ok: false, code: 'habit_not_found' }
    const { client_op_id, status, said } = parsed.data
    const fields = {
      habit_id: habit.id,
      reported_status: status,
      ...(parsed.data.reason_code === undefined ? {} : { reason_code: parsed.data.reason_code }),
      ...(parsed.data.reason_text === undefined ? {} : { reason_text: parsed.data.reason_text }),
      ...(parsed.data.quantity === undefined ? {} : { quantity: parsed.data.quantity }),
      ...(parsed.data.duration_seconds === undefined ? {} : { duration_seconds: parsed.data.duration_seconds }),
      ...(parsed.data.context === undefined ? {} : { context: parsed.data.context })
    }
    const request = {
      contract_version: 'write-1' as const,
      client_op_id,
      sources: [{ ref: 'report', medium: 'text' as const, original_text: said, parent_source: null }],
      writes: [{ op: 'create' as const, table: 'habit_performances', fields,
        cites: [{ source: 'report', role: 'report' as const }],
        envelope: { attribution_date: date, time_zone: HOME_ZONE, attribution_basis: parsed.data.date === undefined ? 'derived' as const : 'user_selected' as const } }]
    }
    const reply = await ledger.write(resolved.route, request, { asserted_by: 'user', captured_by: 'model' })
    return reply.ok ? { ...reply, habit: { id: habit.id, name: habit.name }, date } : reply
  } catch { return { ok: false, code: 'storage_unavailable' } }
}

const verbDate = (date?: string, eventTime?: string): { ok: true; date: string; basis: 'user_selected' | 'derived' } | { ok: false; field: string } => {
  const today = localDateOf(new Date())
  const candidate = date ?? (eventTime === undefined ? today : localDateOf(new Date(eventTime)))
  try { localDayBounds(candidate) } catch { return { ok: false, field: date === undefined ? 'event_time' : 'date' } }
  if (candidate > today) return { ok: false, field: date === undefined ? (eventTime === undefined ? 'date' : 'event_time') : 'date' }
  return { ok: true, date: candidate, basis: date === undefined ? 'derived' : 'user_selected' }
}

async function verbContext(env: WorkerBindings, identity: AuthenticatedIdentity, tool: string) {
  const enabled = assertWritesEnabled(env)
  if (!enabled.ok) return { ok: false as const, code: enabled.code === 'writes_disabled' ? 'writes_disabled' : 'storage_unavailable' }
  const config = readConfig(env)
  if (!config.ok) return { ok: false as const, code: 'storage_unavailable' }
  const rate = await checkRate(env, identity, tool, config.value.NOVA_WRITE_RATE_PER_MIN)
  if (!rate.ok) return { ok: false as const, code: rate.code === 'rate_limited' ? 'rate_limited' : 'storage_unavailable' }
  const resolved = await resolveStoreForTools(env, identity)
  if (!resolved.ok) return { ok: false as const, code: 'storage_unavailable' }
  return { ok: true as const, route: resolved.route, ledger: env.LEDGER.get(env.LEDGER.idFromName(resolved.route.physicalId)) }
}

async function chooseTarget(ctx: Awaited<ReturnType<typeof verbContext>>, kind: 'body_exercise' | 'body_program' | 'mind_quality' | 'mind_medication' | 'schedule_signal', selector: string, missingCode: string, ambiguousCode: string, clientOpId?: string, position?: number) {
  if (!ctx.ok) return { ok: false as const, code: ctx.code }
  const result = await ctx.ledger.resolveLayer5d0(ctx.route, kind, selector, clientOpId, position)
  if (!result.ok) return { ok: false as const, code: 'storage_unavailable' }
  if (!result.candidates.length) return { ok: false as const, code: missingCode }
  if (result.candidates.length > 1) return { ok: false as const, code: ambiguousCode, candidates: result.candidates.slice(0, 5).map(({ id, name }) => ({ id, name })) }
  const target = result.candidates[0]
  if (!target) return { ok: false as const, code: missingCode }
  return { ok: true as const, target }
}

async function chooseTarget1(ctx:Awaited<ReturnType<typeof verbContext>>,kind:'focus_session'|'focus_subject'|'focus_configuration'|'schedule_block'|'learning_practice_item'|'learning_subject'|'learning_ink_document'|'music_track',selector:string,missingCode:string,ambiguousCode:string,clientOpId?:string){
 if(!ctx.ok)return {ok:false as const,code:ctx.code}
 const result=await ctx.ledger.resolveLayer5d1(ctx.route,kind,selector,clientOpId)
 if(!result.ok)return {ok:false as const,code:'storage_unavailable'}
 if(!result.candidates.length)return {ok:false as const,code:missingCode}
 if(result.candidates.length>1)return {ok:false as const,code:ambiguousCode}
 const target=result.candidates[0];if(!target)return {ok:false as const,code:missingCode}
 return {ok:true as const,target}
}

const reportSource = (said: string) => [{ ref: 'report', medium: 'text' as const, original_text: said, parent_source: null }]
const reportCite = [{ source: 'report', role: 'report' as const }]
const actualEnvelope = (date: string, basis: 'user_selected' | 'derived') => ({ attribution_date: date, time_zone: HOME_ZONE, attribution_basis: basis })

export async function invokeBodyLogWorkout(env: WorkerBindings, identity: AuthenticatedIdentity, input: unknown) {
  const parsed = bodyLogWorkoutSchema.safeParse(input)
  if (!parsed.success) return { ok: false as const, code: 'invalid_params', field: String(parsed.error.issues[0]?.path[0] ?? 'input') }
  if ((parsed.data.reason_code !== undefined || parsed.data.reason_text !== undefined) && parsed.data.status !== 'not_done') return { ok: false as const, code: 'invalid_params', field: 'reason_code' }
  if (parsed.data.session_key !== undefined && parsed.data.program === undefined) return { ok: false as const, code: 'invalid_params', field: 'program' }
  const date = verbDate(parsed.data.date)
  if (!date.ok) return { ok: false as const, code: 'invalid_params', field: date.field }
  const ctx = await verbContext(env, identity, 'body.log_workout')
  if (!ctx.ok) return ctx
  let program: { id: string; name: string | null } | undefined
  if (parsed.data.program !== undefined) {
    const found = await chooseTarget(ctx, 'body_program', parsed.data.program, 'program_not_found', 'ambiguous_program', parsed.data.client_op_id)
    if (!found.ok) return found
    program = found.target
  }
  const sets: { exercise: { id: string; name: string | null }; values: Record<string, unknown> }[] = []
  for (const [index, set] of parsed.data.sets.entries()) {
    const found = await chooseTarget(ctx, 'body_exercise', set.exercise, 'exercise_not_found', 'ambiguous_exercise', parsed.data.client_op_id, index)
    if (!found.ok) return { ...found, field: `sets.${index}.exercise` }
    sets.push({ exercise: found.target, values: {
      ...(set.repetitions === undefined ? {} : { repetitions: set.repetitions }),
      ...(set.resistance_grams === undefined ? {} : { resistance_grams: set.resistance_grams }),
      ...(set.distance_meters === undefined ? {} : { distance_meters: set.distance_meters }),
      ...(set.duration_seconds === undefined ? {} : { duration_seconds: set.duration_seconds }),
      ...(set.effort_text === undefined ? {} : { effort_text: set.effort_text })
    } })
  }
  const status = parsed.data.status === 'done' ? 'completed' : parsed.data.status
  const writes = [{ op: 'create' as const, table: 'body_workouts', ref: 'workout', fields: {
    record_kind: 'actual', reported_status: status,
    ...(program ? { program_id: program.id } : {}), ...(parsed.data.session_key === undefined ? {} : { session_key: parsed.data.session_key }),
    ...(parsed.data.reason_code === undefined ? {} : { reason_code: parsed.data.reason_code }),
    ...(parsed.data.reason_text === undefined ? {} : { reason_text: parsed.data.reason_text }),
    ...(parsed.data.pain_discomfort_text === undefined ? {} : { pain_discomfort_text: parsed.data.pain_discomfort_text }),
    ...(parsed.data.context === undefined ? {} : { notes: parsed.data.context })
  }, cites: reportCite, envelope: actualEnvelope(date.date, date.basis) }, ...sets.map((set, index) => ({
    op: 'create' as const, table: 'body_workout_sets', ref: `set_${index + 1}`, fields: {
      workout_id: '#workout', exercise_id: set.exercise.id, position: index + 1,
      ...(set.values.repetitions === undefined ? {} : { repetitions: set.values.repetitions }),
      ...(set.values.resistance_grams === undefined ? {} : { resistance_grams: set.values.resistance_grams }),
      ...(set.values.distance_meters === undefined ? {} : { distance_meters: set.values.distance_meters }),
      ...(set.values.duration_seconds === undefined ? {} : { duration_seconds: set.values.duration_seconds }),
      ...(set.values.effort_text === undefined ? {} : { effort_text: set.values.effort_text })
    }, cites: reportCite
  }))]
  try {
    const reply = await ctx.ledger.write(ctx.route, { contract_version: 'write-1', client_op_id: parsed.data.client_op_id, sources: reportSource(parsed.data.said), writes }, { asserted_by: 'user', captured_by: 'model' })
    return reply.ok ? { ...reply, workout: { id: reply.results.find(result => result.ref === 'workout')?.id ?? null, program: program?.name ?? null, date: date.date } } : reply
  } catch { return { ok: false as const, code: 'storage_unavailable' } }
}

export async function invokeMindLogEntry(env: WorkerBindings, identity: AuthenticatedIdentity, input: unknown) {
  const parsed = mindLogEntrySchema.safeParse(input)
  if (!parsed.success) return { ok: false as const, code: 'invalid_params', field: String(parsed.error.issues[0]?.path[0] ?? 'input') }
  if (parsed.data.event_time !== undefined && Date.parse(parsed.data.event_time) > Date.now()) return { ok: false as const, code: 'invalid_params', field: 'event_time' }
  const date = verbDate(parsed.data.date, parsed.data.event_time)
  if (!date.ok) return { ok: false as const, code: 'invalid_params', field: date.field }
  const ctx = await verbContext(env, identity, 'mind.log_entry')
  if (!ctx.ok) return ctx
  const ratings: { quality: { id: string; name: string | null; minimum: number | null; maximum: number | null; anchors: string | null }; value: number | string }[] = []
  for (const [index, rating] of parsed.data.ratings.entries()) {
    const found = await chooseTarget(ctx, 'mind_quality', rating.quality, 'quality_not_found', 'ambiguous_quality', parsed.data.client_op_id, index)
    if (!found.ok) return { ...found, field: `ratings.${index}.quality` }
    const quality = found.target
    if (rating.numeric_value !== undefined) {
      if ((quality.minimum !== null && rating.numeric_value < quality.minimum) || (quality.maximum !== null && rating.numeric_value > quality.maximum)) return { ok: false as const, code: 'rating_out_of_scale', field: `ratings.${index}.numeric_value` }
      ratings.push({ quality, value: rating.numeric_value })
    } else {
      const labelValue = rating.label_value
      if (labelValue === undefined) return { ok: false as const, code: 'invalid_params', field: `ratings.${index}` }
      const tokens = (quality.anchors ?? '').split(/[;,|\n]/).map(value => value.trim().toLocaleLowerCase()).filter(Boolean)
      if (!tokens.includes(labelValue.trim().toLocaleLowerCase())) return { ok: false as const, code: 'rating_out_of_scale', field: `ratings.${index}.label_value` }
      ratings.push({ quality, value: labelValue })
    }
  }
  const eventTime = parsed.data.event_time
  const precision = parsed.data.time_precision ?? (eventTime === undefined ? 'unknown' : 'instant')
  const writes = [{ op: 'create' as const, table: 'mind_entries', ref: 'entry', fields: {
    account: parsed.data.account, ...(parsed.data.context === undefined ? {} : { context: parsed.data.context })
  }, cites: reportCite, envelope: { ...actualEnvelope(date.date, date.basis), ...(eventTime === undefined ? {} : { event_start_at: new Date(eventTime).toISOString() }), time_precision: precision } }, ...ratings.map((rating, index) => ({
    op: 'create' as const, table: 'mind_ratings', ref: `rating_${index + 1}`, fields: {
      entry_id: '#entry', quality_id: rating.quality.id, ...(typeof rating.value === 'number' ? { numeric_value: rating.value } : { label_value: rating.value })
    }, cites: reportCite
  }))]
  try {
    const reply = await ctx.ledger.write(ctx.route, { contract_version: 'write-1', client_op_id: parsed.data.client_op_id, sources: reportSource(parsed.data.said), writes }, { asserted_by: 'user', captured_by: 'model' })
    return reply.ok ? { ...reply, entry: { id: reply.results.find(result => result.ref === 'entry')?.id ?? null, date: date.date } } : reply
  } catch { return { ok: false as const, code: 'storage_unavailable' } }
}

export async function invokeMindLogMedicationUse(env: WorkerBindings, identity: AuthenticatedIdentity, input: unknown) {
  const parsed = mindLogMedicationUseSchema.safeParse(input)
  if (!parsed.success) return { ok: false as const, code: 'invalid_params', field: String(parsed.error.issues[0]?.path[0] ?? 'input') }
  const date = verbDate(parsed.data.date)
  if (!date.ok) return { ok: false as const, code: 'invalid_params', field: date.field }
  const ctx = await verbContext(env, identity, 'mind.log_medication_use')
  if (!ctx.ok) return ctx
  const found = await chooseTarget(ctx, 'mind_medication', parsed.data.medication, 'medication_not_found', 'ambiguous_medication', parsed.data.client_op_id)
  if (!found.ok) return found
  try {
    const reply = await ctx.ledger.write(ctx.route, { contract_version: 'write-1', client_op_id: parsed.data.client_op_id, sources: reportSource(parsed.data.said), writes: [{
      op: 'create', table: 'mind_medication_reports', ref: 'medication_use', fields: {
        medication_id: found.target.id, use_status: parsed.data.use_status,
        ...(parsed.data.experience === undefined ? {} : { experience: parsed.data.experience })
      }, cites: reportCite, envelope: actualEnvelope(date.date, date.basis)
    }] }, { asserted_by: 'user', captured_by: 'model' })
    return reply.ok ? { ...reply, medication: { id: found.target.id, name: found.target.name }, date: date.date } : reply
  } catch { return { ok: false as const, code: 'storage_unavailable' } }
}

export async function invokeSchedulePlaceSignal(env: WorkerBindings, identity: AuthenticatedIdentity, input: unknown) {
  const parsed = schedulePlaceSignalSchema.safeParse(input)
  if (!parsed.success) return { ok: false as const, code: 'invalid_params', field: String(parsed.error.issues[0]?.path[0] ?? 'input') }
  const start = Date.parse(parsed.data.planned_start_at), end = Date.parse(parsed.data.planned_end_at)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return { ok: false as const, code: 'invalid_params', field: 'planned_end_at' }
  try { new Intl.DateTimeFormat('en-US', { timeZone: parsed.data.time_zone }) } catch { return { ok: false as const, code: 'invalid_params', field: 'time_zone' } }
  const ctx = await verbContext(env, identity, 'schedule.place_signal')
  if (!ctx.ok) return ctx
  const found = await chooseTarget(ctx, 'schedule_signal', parsed.data.signal_id, 'signal_not_found', 'ambiguous_signal', parsed.data.client_op_id)
  if (!found.ok) return found
  const sourceSaid = parsed.data.said
  try {
    const reply = await ctx.ledger.write(ctx.route, { contract_version: 'write-1', client_op_id: parsed.data.client_op_id, sources: reportSource(sourceSaid), writes: [
      { op: 'create', table: 'schedule_blocks', ref: 'block', fields: {
        title: parsed.data.title, kind: parsed.data.kind, flexibility: parsed.data.flexibility, plan_status: 'adopted',
        planned_start_at: new Date(start).toISOString(), planned_end_at: new Date(end).toISOString(), time_zone: parsed.data.time_zone, subject_id: found.target.subject_id
      }, cites: reportCite },
      { op: 'correct', table: 'schedule_signals', ref: 'signal', target: found.target.id, reason: 'Signal placed in the schedule', fields: {
        disposition: 'placed', decision_reason: parsed.data.decision_reason ?? null
      }, cites: reportCite },
      { op: 'create', table: 'schedule_signal_blocks', ref: 'placement', fields: { signal_id: '#signal', block_id: '#block' }, cites: reportCite }
    ] }, { asserted_by: 'user', captured_by: 'model' })
    return reply.ok ? { ...reply, placement: { signal_id: found.target.id, block_id: reply.results.find(result => result.ref === 'block')?.id ?? null } } : reply
  } catch { return { ok: false as const, code: 'storage_unavailable' } }
}

const nowEnvelope=(date:{date:string;basis:'user_selected'|'derived'},eventTime?:string)=>({...actualEnvelope(date.date,date.basis),...(eventTime===undefined?{}:{event_start_at:new Date(eventTime).toISOString(),time_precision:'instant' as const})})
const sessionEventKind={done:'progress',happened:'self_report',unresolved:'obstacle',next:'checkpoint'} as const

export async function invokeFocusStartSession(env:WorkerBindings,identity:AuthenticatedIdentity,input:unknown){
 const parsed=focusStartSessionSchema.safeParse(input);if(!parsed.success)return {ok:false as const,code:'invalid_params',field:String(parsed.error.issues[0]?.path[0]??'input')}
 if(parsed.data.event_time!==undefined&&Date.parse(parsed.data.event_time)>Date.now())return {ok:false as const,code:'invalid_params',field:'event_time'}
 const date=verbDate(parsed.data.date);if(!date.ok)return {ok:false as const,code:'invalid_params',field:date.field}
 const ctx=await verbContext(env,identity,'focus.start_session');if(!ctx.ok)return ctx
 let subjectId:string|undefined,configurationId:string|undefined,blockId:string|undefined
 if(parsed.data.subject_id){const found=await chooseTarget1(ctx,'focus_subject',parsed.data.subject_id,'subject_not_found','ambiguous_subject',parsed.data.client_op_id);if(!found.ok)return {...found,field:'subject_id'};subjectId=found.target.id}
 if(parsed.data.configuration){const found=await chooseTarget1(ctx,'focus_configuration',parsed.data.configuration,'configuration_not_found','ambiguous_configuration',parsed.data.client_op_id);if(!found.ok)return {...found,field:'configuration'};configurationId=found.target.id}
 if(parsed.data.planned_block_id){const found=await chooseTarget1(ctx,'schedule_block',parsed.data.planned_block_id,'planned_block_not_found','ambiguous_planned_block',parsed.data.client_op_id);if(!found.ok)return {...found,field:'planned_block_id'};blockId=found.target.id}
 const now=parsed.data.event_time
 try{return await ctx.ledger.write(ctx.route,{contract_version:'write-1',client_op_id:parsed.data.client_op_id,sources:reportSource(parsed.data.said),writes:[
  {op:'create',table:'focus_sessions',ref:'session',fields:{intention:parsed.data.intention,status:'started',...(parsed.data.reason===undefined?{}:{reason:parsed.data.reason}),...(parsed.data.intended_result===undefined?{}:{intended_result:parsed.data.intended_result}),...(subjectId?{subject_id:subjectId}:{}),...(blockId?{schedule_block_id:blockId}:{}),...(configurationId?{configuration_id:configurationId}:{}),...(parsed.data.planned_seconds===undefined?{}:{planned_seconds:parsed.data.planned_seconds})},cites:reportCite,envelope:nowEnvelope(date,now)},
  {op:'create',table:'focus_events',ref:'start_event',fields:{session_id:'#session',kind:'start',description:parsed.data.said},cites:reportCite,envelope:nowEnvelope(date,now)}
 ]},{asserted_by:'user',captured_by:'model'})}catch{return {ok:false as const,code:'storage_unavailable'}}
}

export async function invokeFocusLogCheckpoint(env:WorkerBindings,identity:AuthenticatedIdentity,input:unknown){
 const parsed=focusLogCheckpointSchema.safeParse(input);if(!parsed.success)return {ok:false as const,code:'invalid_params',field:String(parsed.error.issues[0]?.path[0]??'input')}
 if(parsed.data.event_time!==undefined&&Date.parse(parsed.data.event_time)>Date.now())return {ok:false as const,code:'invalid_params',field:'event_time'}
 const date=verbDate(parsed.data.date);if(!date.ok)return {ok:false as const,code:'invalid_params',field:date.field}
 const ctx=await verbContext(env,identity,'focus.log_checkpoint');if(!ctx.ok)return ctx
 const found=await chooseTarget1(ctx,'focus_session',parsed.data.session_id,'session_not_found','ambiguous_session',parsed.data.client_op_id);if(!found.ok)return {...found,field:'session_id'}
 const fields=['done','happened','unresolved','next'] as const
 const parts=fields.filter(k=>parsed.data[k]!==undefined).map(k=>({key:k,text:parsed.data[k] as string}))
 const writes=parts.map((part,index)=>({op:'create' as const,table:'focus_events',ref:`checkpoint_${index+1}`,fields:{session_id:found.target.id,kind:sessionEventKind[part.key],description:part.text,...(part.key==='next'?{next_action:part.text}:{})},cites:[{source:`part_${index+1}`,role:'report' as const}],envelope:nowEnvelope(date,parsed.data.event_time)}))
 try{return await ctx.ledger.write(ctx.route,{contract_version:'write-1',client_op_id:parsed.data.client_op_id,sources:parts.map((part,index)=>({ref:`part_${index+1}`,medium:'text' as const,original_text:part.text,parent_source:null})),writes},{asserted_by:'user',captured_by:'model'})}catch{return {ok:false as const,code:'storage_unavailable'}}
}

export async function invokeFocusEndSession(env:WorkerBindings,identity:AuthenticatedIdentity,input:unknown){
 const parsed=focusEndSessionSchema.safeParse(input);if(!parsed.success)return {ok:false as const,code:'invalid_params',field:String(parsed.error.issues[0]?.path[0]??'input')}
 const date=verbDate(parsed.data.date);if(!date.ok)return {ok:false as const,code:'invalid_params',field:date.field}
 const ctx=await verbContext(env,identity,'focus.end_session');if(!ctx.ok)return ctx
 const found=await chooseTarget1(ctx,'focus_session',parsed.data.session_id,'session_not_found','ambiguous_session',parsed.data.client_op_id);if(!found.ok)return {...found,field:'session_id'}
 const said=parsed.data.reason===undefined?parsed.data.said:`${parsed.data.said}\n${parsed.data.reason}`
 const reasonFields=['not_done','abandoned'].includes(parsed.data.outcome)?{}:{reason_code:null,reason_text:null}
 try{return await ctx.ledger.write(ctx.route,{contract_version:'write-1',client_op_id:parsed.data.client_op_id,sources:reportSource(said),writes:[{op:'correct',table:'focus_sessions',target:found.target.id,reason:'Owner reported Focus session outcome',fields:{status:parsed.data.outcome,...reasonFields},cites:reportCite,envelope:actualEnvelope(date.date,date.basis)}]},{asserted_by:'user',captured_by:'model'})}catch{return {ok:false as const,code:'storage_unavailable'}}
}

export async function invokeLearningLogPracticeAttempt(env:WorkerBindings,identity:AuthenticatedIdentity,input:unknown){
 const parsed=learningLogPracticeAttemptSchema.safeParse(input);if(!parsed.success)return {ok:false as const,code:'invalid_params',field:String(parsed.error.issues[0]?.path[0]??'input')}
 const date=verbDate(parsed.data.date);if(!date.ok)return {ok:false as const,code:'invalid_params',field:date.field}
 const ctx=await verbContext(env,identity,'learning.log_practice_attempt');if(!ctx.ok)return ctx
 const practice=await chooseTarget1(ctx,'learning_practice_item',parsed.data.practice_item_id,'practice_item_not_found','ambiguous_practice_item',parsed.data.client_op_id);if(!practice.ok)return {...practice,field:'practice_item_id'}
 let inkId:string|undefined;if(parsed.data.ink_document_id){const ink=await chooseTarget1(ctx,'learning_ink_document',parsed.data.ink_document_id,'ink_document_not_found','ambiguous_ink_document',parsed.data.client_op_id);if(!ink.ok)return {...ink,field:'ink_document_id'};inkId=ink.target.id}
 try{return await ctx.ledger.write(ctx.route,{contract_version:'write-1',client_op_id:parsed.data.client_op_id,sources:reportSource(parsed.data.response_text),writes:[{op:'create',table:'learning_attempts',fields:{practice_item_id:practice.target.id,response_text:parsed.data.response_text,reported_status:parsed.data.status,...(inkId?{ink_document_id:inkId}:{})},cites:reportCite,envelope:nowEnvelope(date)}]},{asserted_by:'user',captured_by:'model'})}catch{return {ok:false as const,code:'storage_unavailable'}}
}

export async function invokeLearningLogHelpRequest(env:WorkerBindings,identity:AuthenticatedIdentity,input:unknown){
 const parsed=learningLogHelpRequestSchema.safeParse(input);if(!parsed.success)return {ok:false as const,code:'invalid_params',field:String(parsed.error.issues[0]?.path[0]??'input')}
 const date=verbDate(parsed.data.date);if(!date.ok)return {ok:false as const,code:'invalid_params',field:date.field}
 const ctx=await verbContext(env,identity,'learning.log_help_request');if(!ctx.ok)return ctx
 const subject=await chooseTarget1(ctx,'learning_subject',parsed.data.subject_id,'subject_not_found','ambiguous_subject',parsed.data.client_op_id);if(!subject.ok)return {...subject,field:'subject_id'}
 try{return await ctx.ledger.write(ctx.route,{contract_version:'write-1',client_op_id:parsed.data.client_op_id,sources:reportSource(parsed.data.request_text),writes:[{op:'create',table:'learning_help',fields:{subject_id:subject.target.id,request_source_id:'#report',mode:parsed.data.mode,status:'requested'},cites:reportCite,envelope:nowEnvelope(date)}]},{asserted_by:'user',captured_by:'model'})}catch{return {ok:false as const,code:'storage_unavailable'}}
}

export async function invokeMusicLogInterpretation(env:WorkerBindings,identity:AuthenticatedIdentity,input:unknown){
 const parsed=musicLogInterpretationSchema.safeParse(input);if(!parsed.success)return {ok:false as const,code:'invalid_params',field:String(parsed.error.issues[0]?.path[0]??'input')}
 const date=verbDate(parsed.data.date);if(!date.ok)return {ok:false as const,code:'invalid_params',field:date.field}
 const ctx=await verbContext(env,identity,'music.log_interpretation');if(!ctx.ok)return ctx
 const track=await chooseTarget1(ctx,'music_track',parsed.data.track,'track_not_found','ambiguous_track',parsed.data.client_op_id);if(!track.ok)return {...track,field:'track'}
 try{return await ctx.ledger.write(ctx.route,{contract_version:'write-1',client_op_id:parsed.data.client_op_id,sources:reportSource(parsed.data.interpretation),writes:[{op:'create',table:'annotations',fields:{subject_id:track.target.id,category:'interpretation',body:parsed.data.interpretation,status:'explored'},cites:reportCite,envelope:nowEnvelope(date)}]},{asserted_by:'user',captured_by:'model'})}catch{return {ok:false as const,code:'storage_unavailable'}}
}
