import { DurableObject } from 'cloudflare:workers'
import { z } from 'zod'
import { deploymentSchema, failure, handleSchema, identitySchema, logicalStoreSchema, resolvedStoreSchema } from '../contracts/store'
import type { AuthenticatedIdentity, ResolvedStore, Result, openedStoreSchema } from '../contracts/store'
import { migrate } from '../ledger/migrations'
import { controlMigrations } from './schema'

interface ControlEnvironment { DEPLOYMENT_ID?: string }
interface HandleRow extends Record<string, SqlStorageValue> {
  logical_name: string; physical_id: string; generation: number; subject: string;
  client_id: string; deployment_id: string; expires_at: number | null; revoked_at: number | null
}
interface MapRow extends Record<string, SqlStorageValue> { logical_name: string; physical_id: string; generation: number }
interface QuarantineRow extends Record<string, SqlStorageValue> {
  physical_id: string; source_logical: 'real' | 'sandbox'; target_logical: 'real' | 'sandbox';
  state: string; export_id: string; created_at: number; report_code: string | null
}
type OpenedStore = z.infer<typeof openedStoreSchema>
export const SANDBOX_TTL_MS = 4 * 60 * 60 * 1000
const TOOL_RATE_EVENT_CAP = 100_000
const storedHandleSchema = z.object({
  logical_name: logicalStoreSchema,
  physical_id: resolvedStoreSchema.shape.physicalId,
  generation: resolvedStoreSchema.shape.generation,
  subject: identitySchema.shape.subject,
  client_id: identitySchema.shape.clientId,
  deployment_id: deploymentSchema,
  expires_at: z.number().int().nonnegative().nullable(),
  revoked_at: z.number().int().nonnegative().nullable()
})

async function digest(handle: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(handle)))
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('')
}

export class ControlDO extends DurableObject<ControlEnvironment> {
  // layer3d: restore quarantine registry and explicit activation boundary.
  quarantineCreate(input: unknown) {
    const r = z.strictObject({ physicalId: resolvedStoreSchema.shape.physicalId, sourceLogical: logicalStoreSchema,
      targetLogical: logicalStoreSchema, exportId: z.string().min(1).max(128) }).parse(input)
    return this.ctx.storage.transactionSync(() => {
      if (this.ctx.storage.sql.exec('SELECT 1 FROM quarantine_stores WHERE physical_id=?', r.physicalId).toArray().length ||
        this.ctx.storage.sql.exec('SELECT 1 FROM store_map WHERE physical_id=?', r.physicalId).toArray().length) return failure('store_unavailable')
      this.ctx.storage.sql.exec(`INSERT INTO quarantine_stores
        (physical_id,source_logical,state,created_at,export_id,target_logical,report_code)
        VALUES (?,?,'created',?,?,?,NULL)`, r.physicalId, r.sourceLogical, Date.now(), r.exportId, r.targetLogical)
      const target = this.mapping(r.targetLogical)
      return { ok: true as const, generation: target ? target.generation + 1 : null }
    })
  }

  quarantineAdvance(input: unknown) {
    const r = z.strictObject({ physicalId: z.string().min(1).max(128),
      state: z.enum(['loading','replaying','review_pending','verified']) }).parse(input)
    return this.ctx.storage.transactionSync(() => {
      const row = this.quarantine(r.physicalId)
      if (!row || row.state === 'failed' || row.state === 'active' || row.state === 'retired') return failure('store_unavailable')
      const allowed: Record<string, string[]> = { created: ['loading'], loading: ['replaying'], replaying: ['review_pending','verified'] }
      if (!allowed[row.state]?.includes(r.state)) return failure('invalid_input')
      if (r.state === 'verified' && !this.reviewsComplete(r.physicalId)) return failure('store_unavailable')
      this.ctx.storage.sql.exec('UPDATE quarantine_stores SET state=?, report_code=NULL WHERE physical_id=?', r.state, r.physicalId)
      return { ok: true as const }
    })
  }

  quarantineRequireReview(input: unknown) {
    const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    const r = z.strictObject({ physicalId: z.string().min(1).max(128), recordIds: z.array(uuid).min(1).max(10_000) }).parse(input)
    if (new Set(r.recordIds).size !== r.recordIds.length) return failure('invalid_input')
    return this.ctx.storage.transactionSync(() => {
      const row = this.quarantine(r.physicalId)
      if (!row || row.state !== 'replaying') return failure('store_unavailable')
      this.ensureReviewTables()
      for (const recordId of r.recordIds) this.ctx.storage.sql.exec(
        'INSERT OR IGNORE INTO quarantine_review_required(physical_id,record_id) VALUES (?,?)', r.physicalId, recordId)
      return { ok: true as const, required: this.reviewIds(r.physicalId).length }
    })
  }

  restoreReview(input: unknown) {
    const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    const r = z.strictObject({ restoreId: z.string().min(1).max(128), decisions: z.array(z.strictObject({
      record_id: uuid, action: z.enum(['erase','retain_nonrevealing'])
    })).min(1).max(10_000) }).parse(input)
    if (new Set(r.decisions.map(item => item.record_id)).size !== r.decisions.length) return failure('invalid_input')
    return this.ctx.storage.transactionSync(() => {
      const row = this.quarantine(r.restoreId)
      if (!row || row.state !== 'review_pending') return failure('store_unavailable')
      this.ensureReviewTables()
      const required = this.reviewIds(r.restoreId)
      if (!required.length || required.length !== r.decisions.length || required.some(id => !r.decisions.some(item => item.record_id === id)))
        return failure('invalid_input')
      this.ctx.storage.sql.exec('DELETE FROM quarantine_review_decisions WHERE physical_id=?', r.restoreId)
      for (const decision of r.decisions) this.ctx.storage.sql.exec(
        'INSERT INTO quarantine_review_decisions(physical_id,record_id,action) VALUES (?,?,?)', r.restoreId, decision.record_id, decision.action)
      this.ctx.storage.sql.exec("UPDATE quarantine_stores SET state='replaying',report_code=NULL WHERE physical_id=?", r.restoreId)
      return { ok: true as const, decisions: r.decisions.length }
    })
  }

  quarantineFail(input: unknown) {
    const r = z.strictObject({ physicalId: z.string().min(1).max(128), code: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/) }).parse(input)
    return this.ctx.storage.transactionSync(() => {
      const row = this.quarantine(r.physicalId)
      if (!row || row.state === 'active' || row.state === 'retired') return failure('store_unavailable')
      this.ctx.storage.sql.exec("UPDATE quarantine_stores SET state='failed', report_code=? WHERE physical_id=?", r.code, r.physicalId)
      return { ok: true as const }
    })
  }

  quarantineRetire(input: unknown) {
    const r = z.strictObject({ physicalId: z.string().min(1).max(128) }).parse(input)
    return this.ctx.storage.transactionSync(() => {
      const row = this.quarantine(r.physicalId)
      if (!row || row.state !== 'failed') return failure('store_unavailable')
      this.ctx.storage.sql.exec("UPDATE quarantine_stores SET state='retired' WHERE physical_id=?", r.physicalId)
      return { ok: true as const }
    })
  }

  quarantineActivate(input: unknown) {
    const r = z.strictObject({ restoreId: z.string().min(1).max(128), explicitTargetLogical: logicalStoreSchema }).parse(input)
    return this.ctx.storage.transactionSync(() => {
      const restored = this.quarantine(r.restoreId)
      if (!restored || restored.state !== 'verified' || !this.reviewsComplete(r.restoreId) || restored.target_logical !== r.explicitTargetLogical)
        return failure('store_unavailable')
      const current = this.mapping(r.explicitTargetLogical)
      if (!current || current.physicalId === restored.physical_id) return failure('store_unavailable')
      const nextGeneration = current.generation + 1
      this.ctx.storage.sql.exec('UPDATE store_map SET physical_id=?, generation=? WHERE logical_name=? AND physical_id=? AND generation=?',
        restored.physical_id, nextGeneration, r.explicitTargetLogical, current.physicalId, current.generation)
      if (this.ctx.storage.sql.exec('SELECT changes() AS count').one().count !== 1) return failure('store_unavailable')
      this.ctx.storage.sql.exec("UPDATE quarantine_stores SET state='active' WHERE physical_id=?", restored.physical_id)
      this.ctx.storage.sql.exec(`INSERT INTO quarantine_stores
        (physical_id,source_logical,state,created_at,export_id,target_logical,report_code)
        VALUES (?,?,'retired',?,?,?,NULL)
        ON CONFLICT(physical_id) DO UPDATE SET state='retired'`,
      current.physicalId, current.logicalName, Date.now(), `retired:${r.restoreId}`, current.logicalName)
      return { ok: true as const, store: { logicalName: r.explicitTargetLogical, physicalId: restored.physical_id,
        generation: nextGeneration, deploymentId: this.env.DEPLOYMENT_ID } }
    })
  }

  quarantineStatus(input: unknown) {
    const r = z.strictObject({ physicalId: z.string().min(1).max(128) }).parse(input)
    const row = this.quarantine(r.physicalId)
    return row ? { state: row.state, reportCode: row.report_code } : null
  }

  // Internal mailbox only. The adapter derives scope from authenticated identity + resolved route.
  navigation(input: unknown) {
    const r = z.strictObject({ scope: z.string().regex(/^[a-f0-9]{64}$/), method: z.enum(['navigate', 'poll']),
      room: z.string().max(64).optional(), section: z.string().max(64).optional(), card_id: z.uuid().optional(),
      last_seen_sequence: z.number().int().nonnegative().optional() }).parse(input)
    return this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql, now = Date.now()
      const current = sql.exec<{ sequence: number; room: string; section: string | null; expires_at: number }>('SELECT * FROM navigation_views WHERE scope = ?', r.scope).toArray()[0]
      if (r.method === 'navigate') {
        const sequence = (current?.sequence ?? 0) + 1
        sql.exec('INSERT INTO navigation_views VALUES (?, ?, ?, ?, ?) ON CONFLICT(scope) DO UPDATE SET sequence = excluded.sequence, room = excluded.room, section = excluded.section, expires_at = excluded.expires_at', r.scope, sequence, r.room ?? 'home', r.section ?? null, now + 60000)
        const card = sql.exec<{ checked_at: number }>('SELECT checked_at FROM navigation_cards WHERE scope = ? ORDER BY ordinal DESC LIMIT 1', r.scope).toArray()[0]
        return { sequence, delivered: Boolean(card && card.checked_at > now - 20000), active: false, view: null }
      }
      if (!r.card_id) throw new Error('Card required')
      const known = sql.exec<{ acknowledged: number }>('SELECT acknowledged FROM navigation_cards WHERE scope = ? AND card_id = ?', r.scope, r.card_id).toArray()[0]
      if (!known) {
        const ordinal = sql.exec<{ n: number }>('SELECT COALESCE(MAX(ordinal), 0) + 1 AS n FROM navigation_cards WHERE scope = ?', r.scope).one().n
        sql.exec('INSERT INTO navigation_cards VALUES (?, ?, ?, ?, ?)', r.scope, r.card_id, ordinal, now, current?.sequence ?? 0)
        // Retain only a bounded set of recent cards. Old host cards still use local election.
        sql.exec('DELETE FROM navigation_cards WHERE scope = ? AND ordinal <= ?', r.scope, ordinal - 16)
      }
      const latest = sql.exec<{ card_id: string }>('SELECT card_id FROM navigation_cards WHERE scope = ? ORDER BY ordinal DESC LIMIT 1', r.scope).one()
      const active = latest.card_id === r.card_id
      if (active) sql.exec('UPDATE navigation_cards SET checked_at = ? WHERE scope = ? AND card_id = ?', now, r.scope, r.card_id)
      const acknowledged = Math.max(known?.acknowledged ?? current?.sequence ?? 0, Math.min(current?.sequence ?? 0, r.last_seen_sequence ?? 0))
      if (active) sql.exec('UPDATE navigation_cards SET acknowledged = ? WHERE scope = ? AND card_id = ?', acknowledged, r.scope, r.card_id)
      // A newly mounted card baselines old requests rather than replaying navigation from a prior mount.
      const view = active && known && current && current.expires_at > now && current.sequence > acknowledged
        ? { room: current.room, ...(current.section ? { section: current.section } : {}) } : null
      return { sequence: current?.sequence ?? 0, active, view, delivered: false }
    })
  }

  // Read-only diagnostics; never consumes or grants transaction authority.
  // Tombstones are bounded by authTransaction's existing retention window.
  authTransactionStatus(input: unknown): 'unknown' | 'pending' | 'consumed' | 'expired' {
    const request = z.strictObject({ kind: z.enum(['consent', 'upstream']), keyHash: z.string().regex(/^[a-f0-9]{64}$/) }).parse(input)
    const row = this.ctx.storage.sql.exec('SELECT expires_at, consumed_at FROM auth_transactions WHERE kind = ? AND key_hash = ?',
      request.kind, request.keyHash).toArray()[0]
    const stored = z.object({ expires_at: z.number().int().nonnegative(), consumed_at: z.number().int().nonnegative().nullable() }).safeParse(row)
    if (!stored.success) return 'unknown'
    if (stored.data.consumed_at !== null) return 'consumed'
    return stored.data.expires_at <= Date.now() ? 'expired' : 'pending'
  }

  authTransaction(input: unknown): boolean {
    const request = z.strictObject({ operation: z.enum(['register', 'consume']),
      kind: z.enum(['consent', 'upstream']), keyHash: z.string().regex(/^[a-f0-9]{64}$/) }).parse(input)
    return this.ctx.storage.transactionSync(() => {
      const now = Date.now()
      this.ctx.storage.sql.exec('DELETE FROM auth_transactions WHERE expires_at < ?', now - 20 * 60 * 1000)
      const row = this.ctx.storage.sql.exec<{ expires_at: number; consumed_at: number | null }>(
        'SELECT expires_at, consumed_at FROM auth_transactions WHERE kind = ? AND key_hash = ?', request.kind, request.keyHash).toArray()[0]
      if (request.operation === 'register') {
        if (row) return false
        this.ctx.storage.sql.exec('INSERT INTO auth_transactions VALUES (?, ?, ?, NULL)', request.kind, request.keyHash, now + 10 * 60 * 1000)
        return true
      }
      const stored = z.object({ expires_at: z.number().int().nonnegative(), consumed_at: z.number().int().nonnegative().nullable() }).safeParse(row)
      if (!stored.success || stored.data.consumed_at !== null || stored.data.expires_at <= now) return false
      this.ctx.storage.sql.exec('UPDATE auth_transactions SET consumed_at = ? WHERE kind = ? AND key_hash = ?', now, request.kind, request.keyHash)
      return true
    })
  }

  // Internal pre-auth bookkeeping, not exposed as an MCP tool or HTTP endpoint.
  claimAuthOnce(input: unknown): boolean {
    const parsed = z.strictObject({ kind: z.literal('authorization_code'),
      keyHash: z.string().regex(/^[a-f0-9]{64}$/) }).parse(input)
    return this.ctx.storage.transactionSync(() => {
      const now = Date.now()
      this.ctx.storage.sql.exec('DELETE FROM auth_once WHERE expires_at <= ?', now)
      const exists = this.ctx.storage.sql.exec('SELECT 1 FROM auth_once WHERE kind = ? AND key_hash = ?', parsed.kind, parsed.keyHash).toArray()[0]
      if (exists) return false
      this.ctx.storage.sql.exec('INSERT INTO auth_once VALUES (?, ?, ?)', parsed.kind, parsed.keyHash, now + 20 * 60 * 1000)
      return true
    })
  }

  admitAuthRequest(input: unknown): boolean {
    const kind = z.enum(['register', 'authorize', 'token', 'callback']).parse(input)
    return this.ctx.storage.transactionSync(() => {
      const window = Math.floor(Date.now() / 60_000)
      this.ctx.storage.sql.exec('INSERT INTO auth_rate VALUES (?, ?, 1) ON CONFLICT(kind) DO UPDATE SET count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END, window_start = excluded.window_start', kind, window)
      const row = this.ctx.storage.sql.exec<{ count: number }>('SELECT count FROM auth_rate WHERE kind = ?', kind).one()
      return row.count <= (kind === 'register' ? 10 : 60)
    })
  }

  // A one-minute sliding window. Rows older than the window are pruned on each
  // call, so there are no timers and storage use is bounded even during bursts.
  async checkToolRate(input: unknown): Promise<boolean> {
    const request = z.strictObject({ identity: identitySchema, tool: z.string().min(1).max(64),
      limit: z.number().int().positive().max(10_000) }).parse(input)
    if (request.identity.deploymentId !== this.env.DEPLOYMENT_ID) return false
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(request.identity.subject)))
    const owner = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
    return this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql, now = Date.now(), cutoff = now - 60_000
      sql.exec('CREATE TABLE IF NOT EXISTS tool_rate_events (owner_hash TEXT NOT NULL, tool TEXT NOT NULL, event_at INTEGER NOT NULL)')
      sql.exec('CREATE INDEX IF NOT EXISTS tool_rate_events_window ON tool_rate_events(event_at)')
      sql.exec('DELETE FROM tool_rate_events WHERE event_at <= ?', cutoff)
      const count = sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM tool_rate_events WHERE owner_hash = ? AND tool = ?', owner, request.tool).one().count
      if (count >= request.limit) return false
      const total = sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM tool_rate_events').one().count
      if (total >= TOOL_RATE_EVENT_CAP) return false
      sql.exec('INSERT INTO tool_rate_events VALUES (?, ?, ?)', owner, request.tool, now)
      return true
    })
  }

  constructor(ctx: DurableObjectState, env: ControlEnvironment) {
    super(ctx, env)
    if (ctx.id.name !== 'control') throw new Error('Control must use the singleton name.')
    const deploymentId = deploymentSchema.parse(env.DEPLOYMENT_ID)
    migrate(ctx.storage, controlMigrations)
    ctx.storage.transactionSync(() => {
      const stored = ctx.storage.sql.exec<{ deployment_id: string }>('SELECT deployment_id FROM deployment_meta WHERE id = 1').toArray()[0]
      if (stored && stored.deployment_id !== deploymentId) throw new Error('Deployment identity changed.')
      ctx.storage.sql.exec('INSERT OR IGNORE INTO deployment_meta VALUES (1, ?)', deploymentId)
      ctx.storage.sql.exec("INSERT OR IGNORE INTO settings VALUES ('timezone', 'America/Chicago')")
      // Bootstrap only a genuinely new map. A partial/missing map later fails
      // closed; initialization must not silently replace a missing live store.
      if (!stored) {
        for (const name of logicalStoreSchema.options) {
          ctx.storage.sql.exec('INSERT INTO store_map VALUES (?, ?, 1)', name, `ledger-${crypto.randomUUID()}`)
        }
      }
    })
  }

  async open(identityInput: unknown, storeInput: unknown): Promise<Result<OpenedStore>> {
    const identity = this.identity(identityInput)
    if (!identity) return failure('unauthorized')
    const store = logicalStoreSchema.safeParse(storeInput)
    if (!store.success) return failure('invalid_input')
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    const handle = `nova_${btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
    const hash = await digest(handle)
    try {
      return this.ctx.storage.transactionSync(() => {
        const mapped = this.mapping(store.data)
        if (!mapped) return failure('store_unavailable')
        const now = Date.now()
        const expiresAt = store.data === 'sandbox' ? now + SANDBOX_TTL_MS : null
        this.ctx.storage.sql.exec('INSERT INTO store_handles VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)',
          hash, mapped.logicalName, mapped.physicalId, mapped.generation,
          identity.subject, identity.clientId, identity.deploymentId, now, expiresAt)
        return { ok: true, value: { handle, store: mapped, expiresAt } }
      })
    } catch { return failure('storage_unavailable') }
  }

  async resolve(identityInput: unknown, handleInput: unknown): Promise<Result<ResolvedStore>> {
    const identity = this.identity(identityInput)
    if (!identity) return failure('unauthorized')
    const handle = handleSchema.safeParse(handleInput)
    if (!handle.success) return failure('invalid_input')
    const hash = await digest(handle.data)
    try { return this.ctx.storage.transactionSync(() => this.lookup(identity, hash)) }
    catch { return failure('storage_unavailable') }
  }

  // Internal revocation of a caller's own handle only; no public admin operation.
  async revoke(identityInput: unknown, handleInput: unknown): Promise<Result<null>> {
    const identity = this.identity(identityInput)
    if (!identity) return failure('unauthorized')
    const handle = handleSchema.safeParse(handleInput)
    if (!handle.success) return failure('invalid_input')
    const hash = await digest(handle.data)
    try {
      return this.ctx.storage.transactionSync(() => {
        const found = this.lookup(identity, hash)
        if (!found.ok) return found
        this.ctx.storage.sql.exec('UPDATE store_handles SET revoked_at = ? WHERE handle_hash = ?', Date.now(), hash)
        return { ok: true, value: null }
      })
    } catch { return failure('storage_unavailable') }
  }

  private identity(input: unknown): AuthenticatedIdentity | null {
    const parsed = identitySchema.safeParse(input)
    return parsed.success && parsed.data.deploymentId === this.env.DEPLOYMENT_ID ? parsed.data : null
  }

  private mapping(logicalName: string): ResolvedStore | null {
    const row = this.ctx.storage.sql.exec<MapRow>('SELECT * FROM store_map WHERE logical_name = ?', logicalName).toArray()[0]
    if (!row) return null
    const parsed = resolvedStoreSchema.safeParse({ logicalName: row.logical_name, physicalId: row.physical_id,
      generation: row.generation, deploymentId: this.env.DEPLOYMENT_ID })
    return parsed.success ? parsed.data : null
  }

  private quarantine(physicalId: string): QuarantineRow | undefined {
    return this.ctx.storage.sql.exec<QuarantineRow>('SELECT * FROM quarantine_stores WHERE physical_id=?', physicalId).toArray()[0]
  }

  private ensureReviewTables(): void {
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS quarantine_review_required (
      physical_id TEXT NOT NULL REFERENCES quarantine_stores(physical_id) ON DELETE CASCADE,
      record_id TEXT NOT NULL, PRIMARY KEY(physical_id,record_id))`)
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS quarantine_review_decisions (
      physical_id TEXT NOT NULL, record_id TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('erase','retain_nonrevealing')),
      PRIMARY KEY(physical_id,record_id),
      FOREIGN KEY(physical_id,record_id) REFERENCES quarantine_review_required(physical_id,record_id) ON DELETE CASCADE)`)
  }

  private reviewIds(physicalId: string): string[] {
    return this.ctx.storage.sql.exec<{ record_id: string }>(
      'SELECT record_id FROM quarantine_review_required WHERE physical_id=? ORDER BY record_id', physicalId).toArray().map(row => row.record_id)
  }

  private reviewsComplete(physicalId: string): boolean {
    this.ensureReviewTables()
    const counts = this.ctx.storage.sql.exec<{ required: number; decided: number }>(`SELECT
      (SELECT COUNT(*) FROM quarantine_review_required WHERE physical_id=?) AS required,
      (SELECT COUNT(*) FROM quarantine_review_decisions WHERE physical_id=?) AS decided`, physicalId, physicalId).one()
    return counts.required === counts.decided
  }

  private lookup(identity: AuthenticatedIdentity, hash: string): Result<ResolvedStore> {
    const stored = this.ctx.storage.sql.exec<HandleRow>('SELECT * FROM store_handles WHERE handle_hash = ?', hash).toArray()[0]
    if (!stored) return failure('store_handle_unknown')
    const parsed = storedHandleSchema.safeParse(stored)
    if (!parsed.success) return failure('storage_unavailable')
    const row = parsed.data
    if (row.subject !== identity.subject || row.client_id !== identity.clientId || row.deployment_id !== identity.deploymentId) return failure('unauthorized')
    if (row.revoked_at !== null) return failure('store_handle_revoked')
    if (row.expires_at !== null && row.expires_at <= Date.now()) return failure('store_handle_expired')
    const mapped = this.mapping(row.logical_name)
    if (!mapped) return failure('store_unavailable')
    if (mapped.generation !== row.generation || mapped.physicalId !== row.physical_id) return failure('store_generation_changed')
    return { ok: true, value: mapped }
  }
}
