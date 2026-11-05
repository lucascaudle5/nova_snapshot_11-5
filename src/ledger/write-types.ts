import { z } from 'zod'

export const writeErrorCodes = [
  'invalid_request', 'unknown_table', 'unknown_column', 'invalid_value', 'missing_required', 'unknown_ref',
  'stale_predecessor', 'not_deleted', 'already_deleted', 'unique_conflict', 'reference_missing',
  'rule_violation', 'digest_conflict', 'too_large', 'store_identity_mismatch', 'storage_unavailable',
  'erased', 'source_erased', 'result_erased', 'erasure_list_unavailable', 'store_busy'
] as const
export type WriteErrorCode = typeof writeErrorCodes[number]

const uuid = z.string().uuid().refine(value => value === value.toLowerCase() && value[14] === '4' && '89ab'.includes(value[19] ?? ''), 'Expected lowercase UUIDv4')
const ref = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/)
const jsonValue: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(), z.array(jsonValue), z.record(z.string(), jsonValue)
]))

export const sourceSchema = z.object({
  ref, medium: z.enum(['text', 'audio', 'image', 'document', 'web', 'provider_record', 'artifact']),
  original_text: z.string().optional(), artifact_uri: z.string().optional(), extracted_text: z.string().optional(),
  provider: z.string().optional(), external_id: z.string().optional(), locator: z.string().optional(), parent_source: z.string().nullable()
}).strict()
const citeSchema = z.object({ source: z.string().min(1), role: z.enum(['report', 'observation', 'instruction', 'evidence', 'context']) }).strict()
const envelopeSchema = z.object({
  event_start_at: z.string().nullable().optional(), event_end_at: z.string().nullable().optional(),
  time_precision: z.enum(['instant', 'interval', 'date', 'approximate', 'unknown']).optional(),
  reported_at: z.string().nullable().optional(), attribution_date: z.string().nullable().optional(),
  time_zone: z.string().nullable().optional(), attribution_basis: z.enum(['user_selected', 'source_supplied', 'derived', 'unknown']).optional()
}).strict()
const writeBase = { table: z.string().min(1).max(64), ref: ref.optional(), fields: z.record(z.string(), jsonValue), cites: z.array(citeSchema), envelope: envelopeSchema.optional() }
export const writeItemSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('create'), ...writeBase }).strict(),
  z.object({ op: z.enum(['correct', 'revise']), ...writeBase, target: z.string().min(1), reason: z.string().min(1), cites: z.array(citeSchema) }).strict(),
  z.object({ op: z.enum(['soft_delete', 'restore']), table: writeBase.table, ref: ref.optional(), target: z.string().min(1), reason: z.string().optional(), cites: z.array(citeSchema) }).strict()
])
export const writeRequestSchema = z.object({
  contract_version: z.literal('write-1'), client_op_id: uuid,
  sources: z.array(sourceSchema).max(40).optional(), writes: z.array(writeItemSchema).min(1).max(50)
}).strict()
export type WriteRequest = z.infer<typeof writeRequestSchema>
export type WriteItem = z.infer<typeof writeItemSchema>
export type Caller = { asserted_by: 'user' | 'model' | 'automation' | 'other_person' | 'external_source'; captured_by: 'user' | 'model' | 'automation' }
export type WriteReply =
  | { ok: true; contract_version: 'write-1'; op_seq: number; client_op_id: string; replayed: boolean; results: { ref: string | null; table: string; id: string; root_id: string; change_kind: string }[]; sources: { ref: string; id: string }[] }
  | { ok: false; code: WriteErrorCode; detail?: string; violations?: { rule: string; record_id: string; detail: string }[] }

export function parseWriteRequest(input: unknown): { success: true; data: WriteRequest } | { success: false; code: 'invalid_request' | 'too_large' } {
  try { if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 256 * 1024) return { success: false, code: 'too_large' } }
  catch { return { success: false, code: 'invalid_request' } }
  if (typeof input === 'object' && input !== null) {
    const candidate = input as { writes?: unknown; sources?: unknown }
    if ((Array.isArray(candidate.writes) && candidate.writes.length > 50) ||
      (Array.isArray(candidate.sources) && candidate.sources.length > 40)) return { success: false, code: 'too_large' }
  }
  const parsed = writeRequestSchema.safeParse(input)
  return parsed.success ? { success: true, data: parsed.data } : { success: false, code: 'invalid_request' }
}
