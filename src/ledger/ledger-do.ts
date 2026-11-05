import { DurableObject } from 'cloudflare:workers'
import { z } from 'zod'
import { deploymentSchema, failure, resolvedStoreSchema } from '../contracts/store'
import type { ResolvedStore, Result } from '../contracts/store'
import { migrate } from './migrations'
import { schemaMigrations } from './generated-schema'
import { auditAll } from './rules'
import { runFixture } from './compat-fixture'
import { executeWrite } from './write'
import { runView } from './views'
import type { ReadReply, ViewInput } from './views'
import { schemaDescriptors } from './descriptor-registry'
import type { Caller } from './write-types'
import type { WriteReply } from './write-types'
import { erasureControlFor } from '../erasure/client'
import type { ErasureDO } from '../erasure/erasure-do'
import { guardWrite } from '../erasure/guard'
import { eraseExecute, erasePrepare, eraseStatus, type EraseStatusReply } from './erase'
import { R2ArtifactEraser } from './artifacts'
import { feedOperations as queryFeedOperations, feedRecords as queryFeedRecords } from './feed'
import type { FeedErasureBinding } from './feed'
import { abortExpiredExport, ensureExportState, EXPORT_FENCE_MS, exportStart as beginExport, exportStep as advanceExport, type ExportRuntime } from '../backup/export'
import { exportScrub as scrubExports, purgeExpired as purgeExports } from '../backup/scrub'
import { r2Backups } from '../backup/r2'

interface LedgerEnvironment {
  DEPLOYMENT_ID?: string
  COMPAT_MODE?: string
  RETRY_HMAC_SECRET?: string
  ERASURE?: DurableObjectNamespace<ErasureDO>
  ARTIFACTS?: R2Bucket
  BACKUPS?: R2Bucket
  /** Enabled only in the isolated workerd test fixture for reversible drill fault injection. */
  NOVA_DRILL_TEST_SEAMS?: string
}

interface MetaRow extends Record<string, SqlStorageValue> {
  logical_name: string; physical_id: string; generation: number; deployment_id: string
}

export class LedgerDO extends DurableObject<LedgerEnvironment> {
  private writeTail: Promise<void> = Promise.resolve()

  constructor(ctx: DurableObjectState, env: LedgerEnvironment) {
    super(ctx, env)
    deploymentSchema.parse(env.DEPLOYMENT_ID)
    migrate(ctx.storage, schemaMigrations)
  }

  // Called only with a freshly resolved Control route by the internal adapter.
  // No public route accepts a physical ID or caller-created routing context.
  initialize(input: unknown): Result<ResolvedStore> {
    const route = this.route(input)
    if (!route) return failure('store_identity_mismatch')
    try {
      return this.ctx.storage.transactionSync(() => {
        const current = this.metadata()
        if (current) return this.compare(route, current)
        this.ctx.storage.sql.exec('INSERT INTO store_meta VALUES (1, ?, ?, ?, ?)',
          route.logicalName, route.physicalId, route.generation, route.deploymentId)
        return { ok: true, value: route }
      })
    } catch { return failure('storage_unavailable') }
  }

  inspect(input: unknown): Result<ResolvedStore> {
    const route = this.route(input)
    if (!route) return failure('store_identity_mismatch')
    try {
      const current = this.metadata()
      return current ? this.compare(route, current) : failure('ledger_uninitialized')
    } catch { return failure('storage_unavailable') }
  }

  compat(routeInput: unknown, request: unknown) {
    const route = this.route(routeInput)
    if (!route) return { ok: false as const, code: 'store_identity_mismatch' }
    if (this.env.COMPAT_MODE !== 'synthetic-only' || route.logicalName !== 'sandbox') return { ok: false as const, code: 'compat_disabled' }
    const inspected = this.inspect(route)
    if (!inspected.ok) return inspected
    const method = (request as { method?: unknown } | null)?.method
    if (method !== 'read' && method !== 'receipt' && method !== 'recover' &&
      this.ctx.storage.sql.exec<{ frozen: number }>('SELECT frozen FROM gates WHERE id=1').one().frozen !== 0)
      return { ok: false as const, code: 'store_busy' }
    try { return runFixture(this.ctx.storage, request) }
    catch { return { ok: false as const, code: 'storage_unavailable' } }
  }

  auditRules() { return auditAll(this.ctx.storage.sql) }

  async write(routeInput: unknown, requestInput: unknown, caller: Caller): Promise<WriteReply> {
    let release!: () => void
    const previous = this.writeTail
    this.writeTail = new Promise<void>(resolve => { release = resolve })
    await previous
    try {
      const route = this.route(routeInput)
      if (!route) return { ok: false, code: 'store_identity_mismatch' }
      const inspected = this.inspect(route)
      if (!inspected.ok) return { ok: false, code: 'store_identity_mismatch' }
      if (this.ctx.storage.sql.exec<{ frozen: number }>('SELECT frozen FROM gates WHERE id=1').one().frozen !== 0)
        return { ok: false, code: 'store_busy' }
      const secret = this.env.RETRY_HMAC_SECRET
      if (!secret || (() => { try { return atob(secret).length < 32 } catch { return true } })()) return { ok: false, code: 'storage_unavailable' }
      if (!this.env.ERASURE) return { ok: false, code: 'erasure_list_unavailable' }
      const guarded = await guardWrite({ control: erasureControlFor(this.env.ERASURE, route), storage: this.ctx.storage,
        descriptors: schemaDescriptors, secret, requestInput })
      if (guarded) return guarded
      try { return await executeWrite(this.ctx, schemaDescriptors, secret, caller, requestInput) }
      catch { return { ok: false, code: 'storage_unavailable' } }
    } finally { release() }
  }

  // Internal read entry point. The service resolves the route from the authenticated
  // identity on every call; this check also rejects stale or cross-store routes.
  read(routeInput: unknown, input: unknown): ReadReply {
    const route = this.route(routeInput)
    if (!route) return { ok: false, code: 'store_unavailable', detail: 'The store could not run this view.' }
    const inspected = this.inspect(route)
    if (!inspected.ok) return { ok: false, code: 'store_unavailable', detail: 'The store could not run this view.' }
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
      typeof (input as Record<string, unknown>).view !== 'string') {
      return { ok: false, code: 'invalid_params', detail: 'view must be a string.' }
    }
    const request = input as Record<string, unknown>
    return runView(this.ctx.storage.sql, request.view as string, {
      ...(request.params === undefined ? {} : { params: request.params })
    } satisfies ViewInput)
  }

  // layer5a: write5a
  // Internal selector used only by habits.log. It returns a bounded list of
  // current adopted revisions and accepts no SQL or table identifiers.
  async resolveHabit(routeInput: unknown, selectorInput: unknown): Promise<
    { ok: true; candidates: { id: string; name: string; status: string }[] } |
    { ok: false; code: 'store_identity_mismatch' | 'storage_unavailable' }> {
    const route = this.route(routeInput)
    const selector = z.string().min(1).max(256).safeParse(selectorInput)
    if (!route || !selector.success) return { ok: false, code: 'store_identity_mismatch' }
    const inspected = this.inspect(route)
    if (!inspected.ok) return { ok: false, code: 'store_identity_mismatch' }
    try {
      const sql = this.ctx.storage.sql
      const prior = sql.exec<{ root_id: string }>(
        "SELECT root_id FROM records WHERE id=? AND kind='habits' AND is_erased=0 LIMIT 1", selector.data).toArray()[0]
      const rows = prior
        ? sql.exec<{ id: string; name: string; status: string }>(
          `SELECT h.id,h.name,h.status FROM records r JOIN habits h ON h.id=r.id
           WHERE r.root_id=? AND r.kind='habits' AND r.is_current=1 AND r.is_erased=0 AND r.deleted_at IS NULL
             AND h.status='adopted' LIMIT 1`, prior.root_id).toArray()
        : sql.exec<{ id: string; name: string; status: string }>(
          `SELECT h.id,h.name,h.status FROM records r JOIN habits h ON h.id=r.id
           WHERE r.kind='habits' AND r.is_current=1 AND r.is_erased=0 AND r.deleted_at IS NULL
             AND h.status='adopted' AND h.name=? COLLATE NOCASE ORDER BY h.name,h.id LIMIT 5`, selector.data).toArray()
      return { ok: true, candidates: rows.map(row => ({ id: row.id, name: row.name, status: row.status })) }
    } catch { return { ok: false, code: 'storage_unavailable' } }
  }

  // layer5d0: prework5d
  // Name and ID lookups for the Schedule, Body and Mind page verbs. The table
  // names are an internal allowlist; selectors never become SQL identifiers.
  async resolveLayer5d0(routeInput: unknown, targetKindInput: unknown, selectorInput: unknown, clientOpIdInput?: unknown, positionInput?: unknown): Promise<
    { ok: true; candidates: { id: string; name: string | null; minimum: number | null; maximum: number | null; anchors: string | null; subject_id: string | null; disposition: string | null }[] } |
    { ok: false; code: 'store_identity_mismatch' | 'storage_unavailable' }> {
    const route = this.route(routeInput)
    const targetKind = z.enum(['body_exercise','body_program','mind_quality','mind_medication','schedule_signal']).safeParse(targetKindInput)
    const selector = z.string().min(1).max(256).safeParse(selectorInput)
    const clientOpId = clientOpIdInput === undefined ? undefined : z.string().uuid().safeParse(clientOpIdInput)
    const position = positionInput === undefined ? undefined : z.number().int().nonnegative().safeParse(positionInput)
    if (!route || !targetKind.success || !selector.success || (clientOpId && !clientOpId.success) || (position && !position.success)) return { ok: false, code: 'store_identity_mismatch' }
    const inspected = this.inspect(route)
    if (!inspected.ok) return { ok: false, code: 'store_identity_mismatch' }
    try {
      const sql = this.ctx.storage.sql
      const kindMap = { body_exercise: 'body_exercises', body_program: 'body_programs', mind_quality: 'mind_qualities', mind_medication: 'mind_medications', schedule_signal: 'schedule_signals' } as const
      const payload = kindMap[targetKind.data]
      const nameColumn = targetKind.data === 'schedule_signal' ? 'reason' : 'name'
      let retryTargetId: string | undefined
      if (clientOpId?.success) {
        const operation = sql.exec<{ op_seq: number }>("SELECT op_seq FROM operations WHERE client_op_id=? AND operation_kind='write'", clientOpId.data).toArray()[0]
        if (operation) {
          const opSeq = operation.op_seq
          if (targetKind.data === 'body_program') retryTargetId = sql.exec<{ id: string }>("SELECT w.program_id AS id FROM body_workouts w JOIN records r ON r.id=w.id WHERE r.op_seq=? AND w.program_id IS NOT NULL ORDER BY r.rowid LIMIT 1", opSeq).toArray()[0]?.id
          else if (targetKind.data === 'body_exercise' && position?.success) retryTargetId = sql.exec<{ id: string }>("SELECT s.exercise_id AS id FROM body_workout_sets s JOIN records r ON r.id=s.id WHERE r.op_seq=? AND s.position=? ORDER BY r.rowid LIMIT 1", opSeq, position.data + 1).toArray()[0]?.id
          else if (targetKind.data === 'mind_quality' && position?.success) retryTargetId = sql.exec<{ id: string }>("SELECT m.quality_id AS id FROM mind_ratings m JOIN records r ON r.id=m.id WHERE r.op_seq=? ORDER BY r.rowid LIMIT 1 OFFSET ?", opSeq, position.data).toArray()[0]?.id
          else if (targetKind.data === 'mind_medication') retryTargetId = sql.exec<{ id: string }>("SELECT m.medication_id AS id FROM mind_medication_reports m JOIN records r ON r.id=m.id WHERE r.op_seq=? ORDER BY r.rowid LIMIT 1", opSeq).toArray()[0]?.id
          else if (targetKind.data === 'schedule_signal') retryTargetId = sql.exec<{ id: string }>("SELECT supersedes_id AS id FROM records WHERE op_seq=? AND kind='schedule_signals' AND supersedes_id IS NOT NULL ORDER BY rowid LIMIT 1", opSeq).toArray()[0]?.id
        }
      }
      const retryRecord = retryTargetId ? sql.exec<{ id: string; root_id: string }>("SELECT id,root_id FROM records WHERE id=? AND kind=? AND is_erased=0 AND deleted_at IS NULL LIMIT 1", retryTargetId, payload).toArray()[0] : undefined
      const prior = retryRecord ?? sql.exec<{ root_id: string }>(
        'SELECT root_id FROM records WHERE id=? AND kind=? AND is_erased=0 AND deleted_at IS NULL LIMIT 1', selector.data, payload).toArray()[0]
      const byId = Boolean(retryRecord || prior)
      const rootId = retryRecord ? null : prior?.root_id ?? null
      if (retryRecord) {
        const retryRows = sql.exec<{ id: string; name: string | null; minimum: number | null; maximum: number | null; anchors: string | null; subject_id: string | null; disposition: string | null }>(
          `SELECT r.id,p.${nameColumn} AS name,${targetKind.data === 'mind_quality' ? 'p.minimum,p.maximum,p.anchors' : 'NULL AS minimum,NULL AS maximum,NULL AS anchors'},${targetKind.data === 'schedule_signal' ? 'p.subject_id' : 'NULL AS subject_id'},${targetKind.data === 'schedule_signal' ? 'p.disposition' : 'NULL AS disposition'} FROM records r JOIN ${payload} p ON p.id=r.id WHERE r.id=? AND r.is_erased=0 AND p.is_erased=0 LIMIT 1`, retryRecord.id).toArray()
        if (retryRows.length) return { ok: true, candidates: retryRows.map(row => ({ ...row })) }
      }
      const rows = sql.exec<{ id: string; name: string | null; minimum: number | null; maximum: number | null; anchors: string | null; subject_id: string | null; disposition: string | null }>(
        `SELECT r.id,p.${nameColumn} AS name,${targetKind.data === 'mind_quality' ? 'p.minimum,p.maximum,p.anchors' : 'NULL AS minimum,NULL AS maximum,NULL AS anchors'},${targetKind.data === 'schedule_signal' ? 'p.subject_id' : 'NULL AS subject_id'},${targetKind.data === 'schedule_signal' ? 'p.disposition' : 'NULL AS disposition'}
         FROM records r JOIN ${payload} p ON p.id=r.id
         WHERE r.kind=? AND r.is_current=1 AND r.is_erased=0 AND r.deleted_at IS NULL AND p.is_current=1 AND p.is_erased=0
           AND (${byId ? 'r.root_id=?' : `p.${nameColumn}=? COLLATE NOCASE`})
         ORDER BY p.${nameColumn},r.id LIMIT 5`, payload, byId ? rootId : selector.data).toArray()
      return { ok: true, candidates: rows.map(row => ({ ...row })) }
    } catch { return { ok: false, code: 'storage_unavailable' } }
  }

  // layer5d1: prework5d1
  // Resolve lane 5d1 selectors only through an internal allowlist. The caller
  // can pass a record ID or an exact case-insensitive display name.
  async resolveLayer5d1(routeInput: unknown, targetKindInput: unknown, selectorInput: unknown, clientOpIdInput?: unknown): Promise<
    { ok: true; candidates: { id: string; name: string | null }[] } |
    { ok: false; code: 'store_identity_mismatch' | 'storage_unavailable' }> {
    const route=this.route(routeInput)
    const kind=z.enum(['focus_session','focus_subject','focus_configuration','schedule_block','learning_practice_item','learning_subject','learning_ink_document','music_track']).safeParse(targetKindInput)
    const selector=z.string().min(1).max(256).safeParse(selectorInput)
    const clientOpId=clientOpIdInput===undefined?undefined:z.string().uuid().safeParse(clientOpIdInput)
    if(!route||!kind.success||!selector.success||(clientOpId&&!clientOpId.success))return {ok:false,code:'store_identity_mismatch'}
    const inspected=this.inspect(route);if(!inspected.ok)return {ok:false,code:'store_identity_mismatch'}
    try {
      const map={
        focus_session:{table:'focus_sessions',name:'intention',recordKind:'focus_sessions'},
        focus_subject:{table:'records',name:'kind',recordKind:null},
        focus_configuration:{table:'focus_configurations',name:'name',recordKind:'focus_configurations'},
        schedule_block:{table:'schedule_blocks',name:'title',recordKind:'schedule_blocks'},
        learning_practice_item:{table:'learning_practice_items',name:'prompt',recordKind:'learning_practice_items'},
        learning_subject:{table:'records',name:'kind',recordKind:null},
        learning_ink_document:{table:'learning_ink_documents',name:'title',recordKind:'learning_ink_documents'},
        music_track:{table:'music_tracks',name:'title',recordKind:'music_tracks'}
      } as const
      const spec=map[kind.data],sql=this.ctx.storage.sql
      const focusSubjectKind=kind.data==='focus_subject'
      const recordKinds=kind.data==='learning_subject'?'learning_topics,learning_assignments,learning_practice_items,learning_attempts,learning_ink_documents':null
      if(clientOpId?.success){
        const operation=sql.exec<{op_seq:number}>("SELECT op_seq FROM operations WHERE client_op_id=? AND operation_kind='write'",clientOpId.data).toArray()[0]
        if(operation){
          let priorId:string|null=null
          if(kind.data==='focus_session')priorId=sql.exec<{id:string}>("SELECT supersedes_id AS id FROM records WHERE op_seq=? AND kind='focus_sessions' AND supersedes_id IS NOT NULL ORDER BY rowid LIMIT 1",operation.op_seq).toArray()[0]?.id??sql.exec<{id:string}>("SELECT session_id AS id FROM focus_events e JOIN records r ON r.id=e.id WHERE r.op_seq=? ORDER BY r.rowid LIMIT 1",operation.op_seq).toArray()[0]?.id??sql.exec<{id:string}>("SELECT id FROM records WHERE op_seq=? AND kind='focus_sessions' ORDER BY rowid LIMIT 1",operation.op_seq).toArray()[0]?.id??null
          else if(kind.data==='focus_subject')priorId=sql.exec<{id:string}>("SELECT subject_id AS id FROM focus_sessions f JOIN records r ON r.id=f.id WHERE r.op_seq=? AND f.subject_id IS NOT NULL ORDER BY r.rowid LIMIT 1",operation.op_seq).toArray()[0]?.id??null
          else if(kind.data==='focus_configuration')priorId=sql.exec<{id:string}>("SELECT configuration_id AS id FROM focus_sessions f JOIN records r ON r.id=f.id WHERE r.op_seq=? AND f.configuration_id IS NOT NULL ORDER BY r.rowid LIMIT 1",operation.op_seq).toArray()[0]?.id??null
          else if(kind.data==='schedule_block')priorId=sql.exec<{id:string}>("SELECT schedule_block_id AS id FROM focus_sessions f JOIN records r ON r.id=f.id WHERE r.op_seq=? AND f.schedule_block_id IS NOT NULL ORDER BY r.rowid LIMIT 1",operation.op_seq).toArray()[0]?.id??null
          else if(kind.data==='learning_practice_item')priorId=sql.exec<{id:string}>("SELECT practice_item_id AS id FROM learning_attempts a JOIN records r ON r.id=a.id WHERE r.op_seq=? AND a.practice_item_id IS NOT NULL ORDER BY r.rowid LIMIT 1",operation.op_seq).toArray()[0]?.id??null
          else if(kind.data==='learning_subject')priorId=sql.exec<{id:string}>("SELECT subject_id AS id FROM learning_help h JOIN records r ON r.id=h.id WHERE r.op_seq=? ORDER BY r.rowid LIMIT 1",operation.op_seq).toArray()[0]?.id??null
          else if(kind.data==='learning_ink_document')priorId=sql.exec<{id:string}>("SELECT ink_document_id AS id FROM learning_attempts a JOIN records r ON r.id=a.id WHERE r.op_seq=? AND a.ink_document_id IS NOT NULL ORDER BY r.rowid LIMIT 1",operation.op_seq).toArray()[0]?.id??null
          else if(kind.data==='music_track')priorId=sql.exec<{id:string}>("SELECT subject_id AS id FROM annotations a JOIN records r ON r.id=a.id WHERE r.op_seq=? AND a.category='interpretation' ORDER BY r.rowid LIMIT 1",operation.op_seq).toArray()[0]?.id??null
          if(priorId){
            const priorRoot=sql.exec<{root_id:string}>("SELECT root_id FROM records WHERE id=? AND is_erased=0 AND deleted_at IS NULL LIMIT 1",priorId).toArray()[0]?.root_id
            if(priorRoot){
              if(focusSubjectKind){const live=sql.exec<{id:string}>("SELECT id FROM records WHERE root_id=? AND is_current=1 AND is_erased=0 AND deleted_at IS NULL LIMIT 1",priorRoot).toArray();const retryRows=live.length?sql.exec<{id:string;name:string|null}>("SELECT id,kind AS name FROM records WHERE id=? AND is_erased=0 AND deleted_at IS NULL ORDER BY kind,id LIMIT 1",priorId).toArray():[];if(retryRows.length)return {ok:true,candidates:retryRows}}
              else if(recordKinds){const choices=recordKinds.split(',');const live=sql.exec<{id:string}>(`SELECT id FROM records WHERE root_id=? AND kind IN (${choices.map(()=>'?').join(',')}) AND is_current=1 AND is_erased=0 AND deleted_at IS NULL LIMIT 1`,priorRoot,...choices).toArray();const retryRows=live.length?sql.exec<{id:string;name:string|null}>(`SELECT id,kind AS name FROM records WHERE id=? AND kind IN (${choices.map(()=>'?').join(',')}) AND is_erased=0 AND deleted_at IS NULL ORDER BY kind,id LIMIT 1`,priorId,...choices).toArray():[];if(retryRows.length)return {ok:true,candidates:retryRows}}
              else {const live=sql.exec<{id:string}>(`SELECT id FROM records WHERE root_id=? AND kind=? AND is_current=1 AND is_erased=0 AND deleted_at IS NULL LIMIT 1`,priorRoot,spec.recordKind).toArray();const retryRows=live.length?sql.exec<{id:string;name:string|null}>(`SELECT r.id,p.${spec.name} AS name FROM records r JOIN ${spec.table} p ON p.id=r.id WHERE r.id=? AND r.kind=? AND r.is_erased=0 AND r.deleted_at IS NULL AND p.is_erased=0 ORDER BY r.id LIMIT 1`,priorId,spec.recordKind).toArray():[];if(retryRows.length)return {ok:true,candidates:retryRows}}
            }
          }
        }
      }
      if(focusSubjectKind){
        const rows=sql.exec<{id:string;name:string|null}>("SELECT id,kind AS name FROM records WHERE is_current=1 AND is_erased=0 AND deleted_at IS NULL AND root_id=(SELECT root_id FROM records WHERE id=? AND is_erased=0 AND deleted_at IS NULL) ORDER BY kind,id LIMIT 5",selector.data).toArray()
        return {ok:true,candidates:rows}
      }
      if(recordKinds){
        const choices=recordKinds.split(',')
        const rows=sql.exec<{id:string;name:string|null}>(`SELECT r.id,r.kind AS name FROM records r WHERE r.is_current=1 AND r.is_erased=0 AND r.deleted_at IS NULL AND r.kind IN (${choices.map(()=>'?').join(',')}) AND r.root_id=(SELECT root_id FROM records WHERE id=? AND is_erased=0 AND deleted_at IS NULL) ORDER BY r.kind,r.id LIMIT 5`,...choices,selector.data).toArray()
        return {ok:true,candidates:rows}
      }
      const byId=sql.exec<{root_id:string}>(`SELECT root_id FROM records WHERE id=? AND kind=? AND is_erased=0 AND deleted_at IS NULL LIMIT 1`,selector.data,spec.recordKind).toArray()[0]
      const rows=sql.exec<{id:string;name:string|null}>(`SELECT r.id,p.${spec.name} AS name FROM records r JOIN ${spec.table} p ON p.id=r.id WHERE r.kind=? AND r.is_current=1 AND r.is_erased=0 AND r.deleted_at IS NULL AND p.is_current=1 AND p.is_erased=0 AND ${byId?'r.root_id=?':`p.${spec.name}=? COLLATE NOCASE`} ORDER BY p.${spec.name},r.id LIMIT 5`,spec.recordKind,byId?.root_id??selector.data).toArray()
      return {ok:true,candidates:rows}
    } catch {return {ok:false,code:'storage_unavailable'}}
  }
  // end layer5d1: prework5d1
  // layer3c: erase3c
  async erasePrepare(routeInput: unknown, request: unknown) {
    const route = this.route(routeInput)
    const inspected = route && this.inspect(route)
    if (!route || !inspected?.ok) return { ok: false as const, code: 'storage_unavailable' as const }
    const secret = this.env.RETRY_HMAC_SECRET
    if (!secret || !this.env.ERASURE) return { ok: false as const, code: 'erasure_list_unavailable' as const }
    try {
      const control = this.env.ERASURE.get(this.env.ERASURE.idFromName(route.physicalId))
      return await erasePrepare(this.ctx, schemaDescriptors, control, secret, request)
    } catch { return { ok: false as const, code: 'erasure_list_unavailable' as const }
    }
  }

  async eraseExecute(routeInput: unknown, request: unknown) {
    const route = this.route(routeInput)
    const inspected = route && this.inspect(route)
    if (!route || !inspected?.ok) return { ok: false as const, code: 'storage_unavailable' as const }
    if (this.ctx.storage.sql.exec<{ frozen: number }>('SELECT frozen FROM gates WHERE id=1').one().frozen !== 0)
      return { ok: false as const, code: 'store_busy' as const }
    const secret = this.env.RETRY_HMAC_SECRET
    if (!secret || !this.env.ERASURE || !this.env.ARTIFACTS) return { ok: false as const, code: 'erasure_list_unavailable' as const }
    try {
      const control = this.env.ERASURE.get(this.env.ERASURE.idFromName(route.physicalId))
      return await eraseExecute(this.ctx, schemaDescriptors, control, new R2ArtifactEraser(this.env.ARTIFACTS), secret, request)
    } catch { return { ok: false as const, code: 'erasure_list_unavailable' as const }
    }
  }

  eraseStatus(routeInput: unknown, request: unknown): EraseStatusReply | { ok: false; code: 'storage_unavailable' } {
    const route = this.route(routeInput)
    const inspected = route && this.inspect(route)
    if (!route || !inspected?.ok) return { ok: false, code: 'storage_unavailable' }
    const clientOpId = (request as { client_op_id?: unknown } | null)?.client_op_id
    return eraseStatus(this.ctx, clientOpId)
  }

  /** Test-only seam: execute the real erase module while injecting a rolled-back SQL or artifact failure. */
  async drillEraseExecute(routeInput: unknown, requestInput: unknown, fault: 'sql_after_mutation' | 'artifact_once' | 'control_unavailable') {
    if (this.env.NOVA_DRILL_TEST_SEAMS !== 'true') return { ok: false as const, code: 'drill_seam_disabled' }
    const route = this.route(routeInput)
    if (!route || !this.inspect(route).ok || !this.env.ERASURE || !this.env.ARTIFACTS || !this.env.RETRY_HMAC_SECRET)
      return { ok: false as const, code: 'drill_seam_unavailable' }
    const actualControl = erasureControlFor(this.env.ERASURE, route)
    const control = fault === 'control_unavailable'
      ? { ...actualControl, async addErased() { return { ok: false as const, code: 'erasure_list_unavailable' as const } } }
      : actualControl
    const storage = this.ctx.storage
    let failSql = fault === 'sql_after_mutation'
    const ctx = { storage: { sql: storage.sql, transactionSync<T>(fn: () => T): T {
      return storage.transactionSync(() => {
        const result = fn()
        if (failSql) { failSql = false; throw new Error('synthetic_transaction_rollback') }
        return result
      })
    } } }
    const artifacts = fault === 'artifact_once'
      ? { async deleteArtifacts(items: readonly { artifact_id: string }[]) {
          return { deleted: 0, failed: items.map(item => item.artifact_id) }
        } }
      : new R2ArtifactEraser(this.env.ARTIFACTS)
    return eraseExecute(ctx, schemaDescriptors, control, artifacts, this.env.RETRY_HMAC_SECRET, requestInput)
  }

  async drillWriteWithMissingKey(routeInput: unknown, requestInput: unknown) {
    if (this.env.NOVA_DRILL_TEST_SEAMS !== 'true') return { ok: false as const, code: 'drill_seam_disabled' }
    const route = this.route(routeInput)
    if (!route || !this.env.ERASURE) return { ok: false as const, code: 'drill_seam_unavailable' }
    const result = await guardWrite({ control: erasureControlFor(this.env.ERASURE, route), storage: this.ctx.storage,
      descriptors: schemaDescriptors, secret: '', requestInput })
    return result ?? { ok: false as const, code: 'unexpected_guard_pass' }
  }
  // end layer3c: erase3c

  // layer3c: export3d
  private exportRuntime(physicalId?: string): ExportRuntime | null {
    const storePhysicalId = physicalId ?? this.ctx.id.name
    const erasure = this.env.ERASURE
    const backups = this.env.BACKUPS, secret = this.env.RETRY_HMAC_SECRET
    if (!backups || !secret || !erasure || !storePhysicalId) return null
    const storage = this.ctx.storage
    const sql = { sql: storage.sql, transactionSync: <T>(fn: () => T) => storage.transactionSync(fn),
      exec: storage.sql.exec.bind(storage.sql) }
    return {
      sql, backups: r2Backups(backups), secret,
      erasure: erasureControlFor(erasure, { physicalId: storePhysicalId }),
      migrations: schemaMigrations,
    }
  }

  async exportStart(routeInput: unknown, input: { exportId: string }) {
    const route = this.route(routeInput)
    if (!route) return { ok: false as const, code: 'store_identity_mismatch' }
    if (!this.env.ERASURE) return { ok: false as const, code: 'erasure_list_unavailable' }
    const runtime = this.exportRuntime(route.physicalId)
    if (!runtime) return { ok: false as const, code: 'store_unavailable' }
    try {
      const started = await beginExport(runtime, route, input)
      if (started.ok) await this.ctx.storage.setAlarm(Date.now() + EXPORT_FENCE_MS)
      return started
    }
    catch { return { ok: false as const, code: 'storage_unavailable' } }
  }

  async exportStep(routeInput: unknown, input: { exportId: string; cursor?: string }) {
    const route = this.route(routeInput)
    if (!route) return { ok: false as const, code: 'store_identity_mismatch' }
    const runtime = this.exportRuntime(route.physicalId)
    if (!runtime) return { ok: false as const, code: 'store_unavailable' }
    try {
      const result = await advanceExport(runtime, route, input)
      if (result.ok && result.done) await this.ctx.storage.deleteAlarm()
      return result
    }
    catch { return { ok: false as const, code: 'storage_unavailable' } }
  }

  async exportScrub(routeInput: unknown, input: { recordIds: readonly string[] }) {
    const route = this.route(routeInput)
    if (!route) return { ok: false as const, code: 'store_identity_mismatch' }
    const runtime = this.exportRuntime(route.physicalId)
    if (!runtime || !input.recordIds.every(id => typeof id === 'string')) return { ok: false as const, code: 'store_unavailable' }
    try {
      ensureExportState(runtime.sql)
      const inProgress = this.ctx.storage.transactionSync(() => {
        const rows = this.ctx.storage.sql.exec<{ export_id: string }>(
          "SELECT export_id FROM export_runs WHERE physical_id=? AND status IN ('running','finalizing')", route.physicalId).toArray()
        this.ctx.storage.sql.exec("UPDATE export_runs SET status='aborted' WHERE physical_id=? AND status IN ('running','finalizing')", route.physicalId)
        if (rows.length) this.ctx.storage.sql.exec('UPDATE gates SET frozen=0 WHERE id=1')
        return rows.map(row => row.export_id)
      })
      if (inProgress.length) await this.ctx.storage.deleteAlarm()
      return await scrubExports(runtime.backups, runtime, route.physicalId, { ...input, exportId: crypto.randomUUID().toLowerCase(), additionalExportIds: inProgress })
    }
    catch { return { ok: false as const, code: 'storage_unavailable' } }
  }

  async purgeExpired(now = Date.now()) {
    if (!this.env.BACKUPS) return { deleted: 0, failed: 1 }
    try { return await purgeExports(r2Backups(this.env.BACKUPS), `exports/${this.ctx.id.name}/`, now) }
    catch { return { deleted: 0, failed: 1 } }
  }

  override async alarm() {
    const runtime = this.exportRuntime()
    if (!runtime) return
    try {
      const runs = this.ctx.storage.sql.exec<{ export_id: string; physical_id: string; deadline: number }>(
        "SELECT export_id,physical_id,deadline FROM export_runs WHERE status='running' ORDER BY deadline").toArray()
      const now = Date.now()
      for (const run of runs) await abortExpiredExport(runtime, run.export_id, run.physical_id, now)
      const next = this.ctx.storage.sql.exec<{ deadline: number }>(
        "SELECT MIN(deadline) AS deadline FROM export_runs WHERE status='running'").toArray()[0]?.deadline
      if (typeof next === 'number') await this.ctx.storage.setAlarm(Math.max(next, now + 1))
    } catch { /* alarms must not expose storage details */ }
  }
  // end layer3c: export3d

  // layer3d: restore-only import surface. These methods are called by the
  // private restore coordinator on an un-routed Ledger id; tool routing cannot
  // resolve a quarantine registry entry from Control.store_map.
  restoreLoadChunk(input: unknown) {
    const request = input as { restoreId?: unknown; table?: unknown; rows?: unknown }
    if (request.restoreId !== this.ctx.id.name || typeof request.table !== 'string' || !Array.isArray(request.rows) || request.rows.length > 5000)
      return { ok: false as const, code: 'restore_input_invalid' }
    const table = request.table
    if (table !== 'operations' && table !== 'records' && !schemaDescriptors[table]) return { ok: false as const, code: 'restore_table_invalid' }
    const columns = this.ctx.storage.sql.exec<{ name: string }>(`PRAGMA table_info("${table}")`).toArray().map(row => row.name)
    if (!columns.length) return { ok: false as const, code: 'restore_table_invalid' }
    const allowed = table === 'operations' || table === 'records'
      ? new Set(columns)
      : new Set(['id', 'is_current', 'is_erased', ...(schemaDescriptors[table]?.columns.map(column => column.name) ?? [])])
    const knownColumns = new Set(columns)
    try {
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec('PRAGMA defer_foreign_keys=ON')
        for (const value of request.rows as unknown[]) {
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid row')
          const row = { ...(value as Record<string, unknown>) }
          if (table === 'operations') {
            // Exports intentionally omit retry digests and source suppression tokens.
            // Imported writes therefore become sealed, non-replayable history rows.
            row.retry_policy = 'sealed'
            row.request_digest = null
            row.ingested_at = null
            if (row.operation_kind === 'erase') row.blocked_source_tokens = '[]'
          }
          const keys = Object.keys(row)
          if (!keys.length || keys.some(key => !allowed.has(key) || !knownColumns.has(key))) throw new Error('unknown column')
          const params = keys.map(key => row[key])
          if (params.some(item => item !== null && typeof item !== 'string' && typeof item !== 'number')) throw new Error('invalid value')
          this.ctx.storage.sql.exec(`INSERT INTO "${table}" (${keys.map(key => `"${key}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...params as (string | number | null)[])
        }
      })
      return { ok: true as const, count: request.rows.length }
    } catch { return { ok: false as const, code: 'restore_chunk_rejected' } }
  }

  restoreSetGeneration(input: unknown) {
    const parsed = resolvedStoreSchema.safeParse(input)
    if (!parsed.success || parsed.data.physicalId !== this.ctx.id.name) return { ok: false as const, code: 'store_identity_mismatch' }
    const current = this.metadata()
    if (!current) {
      try {
        this.ctx.storage.sql.exec('INSERT INTO store_meta VALUES (1, ?, ?, ?, ?)', parsed.data.logicalName,
          parsed.data.physicalId, parsed.data.generation, parsed.data.deploymentId)
        return { ok: true as const }
      } catch { return { ok: false as const, code: 'storage_unavailable' } }
    }
    try {
      this.ctx.storage.sql.exec('UPDATE store_meta SET logical_name=?, physical_id=?, generation=?, deployment_id=? WHERE id=1',
        parsed.data.logicalName, parsed.data.physicalId, parsed.data.generation, parsed.data.deploymentId)
      return { ok: true as const }
    } catch { return { ok: false as const, code: 'storage_unavailable' } }
  }

  restoreSetIncarnation(input: unknown) {
    const request = input as { restoreId?: unknown; incarnation?: unknown }
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    if (request.restoreId !== this.ctx.id.name || typeof request.incarnation !== 'string' || !uuid.test(request.incarnation))
      return { ok: false as const, code: 'restore_input_invalid' }
    try {
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS export_control (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
        this.ctx.storage.sql.exec("INSERT INTO export_control(key,value) VALUES ('incarnation',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", request.incarnation as string)
      })
      return { ok: true as const }
    } catch { return { ok: false as const, code: 'storage_unavailable' } }
  }

  restoreApplyErasure(input: unknown) {
    const r = input as { restoreId?: unknown; erasedIds?: unknown; eraseOpSeq?: unknown; clientOpId?: unknown; floor?: unknown;
      sourceTokens?: unknown; sealedOperationIds?: unknown; newIncarnation?: unknown }
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    if (r.restoreId !== this.ctx.id.name || !Array.isArray(r.erasedIds) || r.erasedIds.some(id => typeof id !== 'string' || !uuid.test(id)) ||
      !Number.isSafeInteger(r.eraseOpSeq) || !Number.isSafeInteger(r.floor) || (r.eraseOpSeq as number) <= (r.floor as number) ||
      typeof r.clientOpId !== 'string' || !uuid.test(r.clientOpId) || !Array.isArray(r.sourceTokens) ||
      r.sourceTokens.some(token => typeof token !== 'string' || !/^v1:[a-f0-9]{64}$/.test(token)) ||
      !Array.isArray(r.sealedOperationIds) || r.sealedOperationIds.some(id => typeof id !== 'string' || !uuid.test(id)) ||
      typeof r.newIncarnation !== 'string' || !uuid.test(r.newIncarnation)) return { ok: false as const, code: 'restore_input_invalid' }
    const requestedIds = [...new Set(r.erasedIds as string[])]
    const roots = new Set<string>()
    const selected = new Set<string>()
    const sql = this.ctx.storage.sql
    for (let i = 0; i < requestedIds.length; i += 200) {
      const batch = requestedIds.slice(i, i + 200)
      if (!batch.length) continue
      for (const row of sql.exec<{ id: string; root_id: string }>(
        `SELECT id,root_id FROM records WHERE id IN (${batch.map(() => '?').join(',')}) OR root_id IN (${batch.map(() => '?').join(',')})`, ...batch, ...batch).toArray()) {
        selected.add(row.id); roots.add(row.root_id)
      }
    }
    const selectedRoots = [...roots]
    for (let i = 0; i < selectedRoots.length; i += 200) {
      const batch = selectedRoots.slice(i, i + 200)
      for (const row of sql.exec<{ id: string }>(`SELECT id FROM records WHERE root_id IN (${batch.map(() => '?').join(',')})`, ...batch).toArray()) selected.add(row.id)
    }
    // Discover incoming record references through generated payload descriptors.
    // Unapproved roots block mutation so a caller can request per-record review.
    const dependentRoots = new Set<string>()
    const allSelected = [...selected]
    for (const descriptor of Object.values(schemaDescriptors)) for (const column of descriptor.columns) {
      if (!column.references) continue
      for (let i = 0; i < allSelected.length; i += 200) {
        const batch = allSelected.slice(i, i + 200)
        const refs = sql.exec<{ root_id: string }>(`SELECT DISTINCT r.root_id FROM "${descriptor.table}" p
          JOIN records r ON r.id=p.id WHERE p."${column.name}" IN (${batch.map(() => '?').join(',')})`, ...batch).toArray()
        for (const row of refs) if (!roots.has(row.root_id)) dependentRoots.add(row.root_id)
      }
    }
    if (dependentRoots.size) return { ok: false as const, code: 'dependent_review_required', newlyDiscovered: dependentRoots.size }
    const recordIds = [...selected]
    if (!recordIds.length) return { ok: true as const, newlyDiscovered: 0, affected: 0 }
    try {
      const result = this.ctx.storage.transactionSync(() => {
        sql.exec('PRAGMA defer_foreign_keys=ON')
        const affectedSet = new Set<number>()
        for (let i = 0; i < recordIds.length; i += 200) {
          const batch = recordIds.slice(i, i + 200)
          for (const row of sql.exec<{ op_seq: number }>(
            `SELECT DISTINCT op_seq FROM records WHERE id IN (${batch.map(() => '?').join(',')})`, ...batch).toArray()) affectedSet.add(row.op_seq)
        }
        const affected = [...affectedSet].sort((a, b) => a - b)
        const already = sql.exec<{ op_seq: number }>('SELECT op_seq FROM operations WHERE client_op_id=?', r.clientOpId).toArray()[0]
        if (!already) sql.exec(`INSERT INTO operations(op_seq,client_op_id,operation_kind,retry_policy,request_digest,ingested_at,
          erasure_manifest,blocked_source_tokens,erasure_state,backup_state)
          VALUES (?,?,'erase','sealed',NULL,NULL,?,?, 'local_pending','expiry_pending')`, r.eraseOpSeq, r.clientOpId,
        JSON.stringify({ record_ids: recordIds, root_ids: selectedRoots, affected_operation_seqs: affected, dependent_decisions: [], artifact_ids: [] }),
        JSON.stringify([...new Set(r.sourceTokens as string[])]))
        for (const opSeq of affected) sql.exec("UPDATE operations SET retry_policy='sealed',request_digest=NULL,ingested_at=NULL WHERE op_seq=?", opSeq)
        const sealedIds = [...new Set(r.sealedOperationIds as string[])]
        for (let i = 0; i < sealedIds.length; i += 200) {
          const batch = sealedIds.slice(i, i + 200)
          sql.exec(`UPDATE operations SET retry_policy='sealed',request_digest=NULL,ingested_at=NULL WHERE client_op_id IN (${batch.map(() => '?').join(',')})`, ...batch)
        }
        // The payload marker FK cascades from records. First move current markers,
        // then clear payload content, and only then transition the record to a stub.
        for (let i = 0; i < recordIds.length; i += 200) {
          const batch = recordIds.slice(i, i + 200)
          sql.exec(`UPDATE records SET is_current=0 WHERE id IN (${batch.map(() => '?').join(',')}) AND is_erased=0`, ...batch)
        }
        for (let i = 0; i < recordIds.length; i += 200) {
          const batch = recordIds.slice(i, i + 200)
          for (const descriptor of Object.values(schemaDescriptors)) {
            const domain = descriptor.columns.map(column => `"${column.name}"=NULL`).join(',')
            sql.exec(`UPDATE "${descriptor.table}" SET is_current=0,is_erased=1,${domain}
              WHERE id IN (${batch.map(() => '?').join(',')})`, ...batch)
          }
        }
        for (let i = 0; i < recordIds.length; i += 200) {
          const batch = recordIds.slice(i, i + 200)
          sql.exec(`UPDATE records SET is_current=0,is_erased=1,erasure_op_seq=COALESCE(erasure_op_seq,?),
            kind=NULL,change_kind='erased',supersedes_id=NULL,change_reason=NULL,event_start_at=NULL,event_end_at=NULL,
            time_precision=NULL,reported_at=NULL,ingested_at=NULL,attribution_date=NULL,time_zone=NULL,attribution_basis=NULL,
            asserted_by=NULL,captured_by=NULL,client_op_id=NULL,deleted_at=NULL WHERE id IN (${batch.map(() => '?').join(',')}) AND is_erased=0`,
          r.eraseOpSeq, ...batch)
        }
        if (!sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM sqlite_sequence WHERE name='operations'").one().count)
          sql.exec("INSERT INTO sqlite_sequence(name,seq) VALUES ('operations',0)")
        sql.exec("UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name='operations'", r.floor)
        sql.exec('CREATE TABLE IF NOT EXISTS export_control (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
        sql.exec("INSERT INTO export_control(key,value) VALUES ('incarnation',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", r.newIncarnation)
        const violations = auditAll(sql)
        if (violations.length || sql.exec('PRAGMA foreign_key_check').toArray().length) throw new Error('restore audit failed')
        return { affected: affected.length }
      })
      return { ok: true as const, newlyDiscovered: 0, affected: result.affected, records: recordIds.length }
    } catch { return { ok: false as const, code: 'replay_failed' } }
  }

  restoreMarkReplayComplete(input: unknown) {
    const r = input as { restoreId?: unknown; clientOpId?: unknown }
    if (r.restoreId !== this.ctx.id.name || typeof r.clientOpId !== 'string') return { ok: false as const, code: 'restore_input_invalid' }
    try {
      const violations = auditAll(this.ctx.storage.sql)
      const foreignKeys = this.ctx.storage.sql.exec('PRAGMA foreign_key_check').toArray()
      if (violations.length || foreignKeys.length) return { ok: false as const, code: 'verification_failed' }
      this.ctx.storage.sql.exec("UPDATE operations SET erasure_state='local_verified' WHERE client_op_id=? AND operation_kind='erase' AND erasure_state='local_pending'", r.clientOpId)
      return this.ctx.storage.sql.exec('SELECT changes() AS count').one().count === 1
        ? { ok: true as const } : { ok: false as const, code: 'restore_operation_missing' }
    } catch { return { ok: false as const, code: 'verification_failed' } }
  }

  restoreVerify(input: unknown) {
    if (!input || typeof input !== 'object') return { ok: false as const, code: 'store_identity_mismatch' }
    const request = input as { restoreId?: unknown; erasedIds?: unknown }
    if (request.restoreId !== this.ctx.id.name || !Array.isArray(request.erasedIds) ||
      request.erasedIds.some(id => typeof id !== 'string')) return { ok: false as const, code: 'store_identity_mismatch' }
    try {
      const auditViolations = auditAll(this.ctx.storage.sql)
      const foreignKeyViolations = this.ctx.storage.sql.exec('PRAGMA foreign_key_check').toArray()
      const payloadCounts: { bad: number }[] = []
      for (const table of Object.keys(schemaDescriptors)) {
        const count = this.ctx.storage.sql.exec<{ bad: number }>(`SELECT COUNT(*) AS bad FROM "${table}" p
          JOIN records r ON r.id=p.id WHERE (r.is_erased=1 AND (p.is_erased<>1 OR p.is_current<>0))
          OR (r.is_erased=0 AND (p.is_erased<>0 OR p.is_current<>r.is_current))`).one().bad
        payloadCounts.push({ bad: count })
      }
      const stubViolations = this.ctx.storage.sql.exec<{ bad: number }>(`SELECT COUNT(*) AS bad FROM records
        WHERE is_erased=1 AND (kind IS NOT NULL OR supersedes_id IS NOT NULL OR change_kind<>'erased'
          OR change_reason IS NOT NULL OR event_start_at IS NOT NULL OR event_end_at IS NOT NULL OR reported_at IS NOT NULL
          OR ingested_at IS NOT NULL OR deleted_at IS NOT NULL OR attribution_date IS NOT NULL OR time_zone IS NOT NULL
          OR time_precision IS NOT NULL OR attribution_basis IS NOT NULL OR asserted_by IS NOT NULL OR captured_by IS NOT NULL
          OR client_op_id IS NOT NULL OR erasure_op_seq IS NULL)`).one().bad + payloadCounts.reduce((sum, row) => sum + row.bad, 0)
      let listedLiveRecords = 0
      const ids = request.erasedIds as string[]
      for (let i = 0; i < ids.length; i += 200) {
        const batch = ids.slice(i, i + 200)
        if (batch.length) listedLiveRecords += this.ctx.storage.sql.exec<{ count: number }>(
          `SELECT COUNT(*) AS count FROM records WHERE is_erased=0 AND (id IN (${batch.map(() => '?').join(',')}) OR root_id IN (${batch.map(() => '?').join(',')}))`,
          ...batch, ...batch).one().count
      }
      return { ok: true as const, auditViolations: auditViolations.length, foreignKeyViolations: foreignKeyViolations.length,
        cardinalityViolations: auditViolations.filter(item => item.rule === 'P01').length, stubViolations,
        listedLiveRecords }
    } catch { return { ok: false as const, code: 'verification_failed' } }
  }

  schemaStatus() {
    const tableCount = this.ctx.storage.sql.exec<{ count: number }>(`SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN
        ('store_meta','gates','compat_fixture','compat_operations','schema_version')`).one().count
    const totalTableCount = this.ctx.storage.sql.exec<{ count: number }>(`SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%'`).one().count
    const version = this.ctx.storage.sql.exec<{ version: number }>('SELECT COALESCE(MAX(version), 0) AS version FROM schema_version').one().version
    const checksums = this.ctx.storage.sql.exec<{ version: number; checksum: string }>(
      'SELECT version, checksum FROM schema_version ORDER BY version').toArray()
    return { version, table_count: tableCount, total_table_count: totalTableCount, checksums }
  }

  private route(input: unknown): ResolvedStore | null {
    const parsed = resolvedStoreSchema.safeParse(input)
    return parsed.success && parsed.data.deploymentId === this.env.DEPLOYMENT_ID &&
      parsed.data.physicalId === this.ctx.id.name ? parsed.data : null
  }

  private metadata(): MetaRow | undefined {
    return this.ctx.storage.sql.exec<MetaRow>('SELECT * FROM store_meta WHERE id = 1').toArray()[0]
  }

  private compare(route: ResolvedStore, current: MetaRow): Result<ResolvedStore> {
    if (current.logical_name !== route.logicalName || current.physical_id !== route.physicalId ||
      current.deployment_id !== route.deploymentId) return failure('store_identity_mismatch')
    if (current.generation !== route.generation) return failure('store_generation_changed')
    return { ok: true, value: route }
  }

  // layer3c: feed3c
  async feedOperations(routeInput: unknown, request: unknown) {
    const route = this.route(routeInput)
    if (!route) return { ok: false as const, code: 'store_identity_mismatch' }
    const inspected = this.inspect(route)
    if (!inspected.ok) return { ok: false as const, code: 'store_identity_mismatch' }
    try {
      const binding = (this.env as LedgerEnvironment & { ERASURE?: FeedErasureBinding }).ERASURE
      if (!binding) return { ok: false as const, code: 'storage_unavailable' }
      const control = binding.get(binding.idFromName(route.physicalId))
      return await queryFeedOperations(this.ctx.storage, control, request)
    } catch { return { ok: false as const, code: 'storage_unavailable' } }
  }

  // layer3c: feed3c
  async feedRecords(routeInput: unknown, request: unknown) {
    const route = this.route(routeInput)
    if (!route) return { ok: false as const, code: 'store_identity_mismatch' }
    const inspected = this.inspect(route)
    if (!inspected.ok) return { ok: false as const, code: 'store_identity_mismatch' }
    try {
      const binding = (this.env as LedgerEnvironment & { ERASURE?: FeedErasureBinding }).ERASURE
      if (!binding) return { ok: false as const, code: 'storage_unavailable' }
      const control = binding.get(binding.idFromName(route.physicalId))
      return await queryFeedRecords(this.ctx.storage, control, request)
    } catch { return { ok: false as const, code: 'storage_unavailable' } }
  }
}
