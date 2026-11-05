import type { DescriptorMap } from './descriptor-types'
import type { ArtifactEraser, EraseReceipt, ErasureControl } from '../erasure/erasure-types'

type SQL = SqlStorage
type Context = { storage: Pick<DurableObjectState['storage'], 'sql' | 'transactionSync'> }
type Decision = { root_id: string; action: 'erase' | 'retain_nonrevealing' }
type Dependent = { root_id: string; table: string; via: 'source' | 'record_source' | 'annotation' | 'link' | 'incoming_fk' | 'shared_source_consumer' | 'child_excerpt'; revision_ids: string[]; suggestion: 'erase' | 'review' }
type Closure = { roots: { root_id: string; revision_ids: string[] }[]; dependents: Dependent[]; recordIds: string[]; allRootIds: string[]; affectedOperationSeqs: number[]; artifactUris: string[]; highWater: number }
type FailureCode = 'invalid_request' | 'erasure_list_unavailable' | 'scope_changed' | 'unresolved_dependents' | 'operation_not_found' | 'storage_unavailable' | 'already_erased' | 'store_busy'
type PrepareReply = { ok: true; plan_hash: string; incarnation: string; high_water: number; roots: Closure['roots']; dependents: Dependent[]; artifact_uris_count: number; affected_operation_seqs: number[] } | { ok: false; code: FailureCode }
type ExecuteReply = EraseReceipt | { ok: false; code: FailureCode }
export type EraseStatusReply = EraseReceipt | { ok: false; code: FailureCode }
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const q = (name: string) => `"${name.replaceAll('"', '""')}"`
const sorted = (items: Iterable<string>) => [...new Set(items)].sort()
const opaqueUuid = () => crypto.randomUUID().toLowerCase()
class EraseStoreBusy extends Error {}

function assertStoreWritable(sql: SQL): void {
  if (rows<{ frozen: number }>(sql, 'SELECT frozen FROM gates WHERE id=1')[0]?.frozen !== 0) throw new EraseStoreBusy()
}

function validIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 200 && value.every(id => typeof id === 'string' && uuidV4.test(id)) && new Set(value).size === value.length
}
async function sign(secret: string, message: string): Promise<string> {
  const raw = Uint8Array.from(atob(secret), c => c.charCodeAt(0))
  if (raw.length < 32) throw new TypeError('invalid secret')
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)))
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}
const rows = <T extends Record<string, SqlStorageValue>>(sql: SQL, statement: string, ...values: SqlStorageValue[]) => sql.exec<T>(statement, ...values).toArray()

function payloadIds(sql: SQL, table: string, ids: readonly string[]): string[] {
  if (!ids.length) return []
  const found: string[] = []
  for (let offset = 0; offset < ids.length; offset += 80) {
    const batch = ids.slice(offset, offset + 80)
    found.push(...rows<{ id: string }>(sql, `SELECT id FROM ${q(table)} WHERE id IN (${batch.map(() => '?').join(',')})`, ...batch).map(row => row.id))
  }
  return found
}

/** Computes a deterministic, descriptor-driven review closure. It returns ids and table names only. */
export function computeEraseClosure(sql: SQL, descriptors: DescriptorMap, targetIds: readonly string[]): Closure {
  const targets = sorted(targetIds)
  const targetRows = targets.map(id => rows<{ id: string; root_id: string; is_erased: number }>(sql, 'SELECT id,root_id,is_erased FROM records WHERE id=?', id)[0])
  if (targetRows.some(row => !row)) throw new Error('invalid target')
  if (targetRows.some(row => row?.is_erased)) throw new Error('already erased')
  const targetRoots = sorted(targetRows.map(row => {
    if (!row) throw new Error('invalid target')
    return row.root_id
  }))
  const rootRevisions = (roots: readonly string[]) => roots.flatMap(root => rows<{ id: string }>(sql,
    `SELECT id FROM records WHERE root_id=? ORDER BY id`, root).map(row => row.id))
  const primaryIds = sorted(rootRevisions(targetRoots))
  const ids = new Set(primaryIds)
  const dependentByKey = new Map<string, Dependent>()
  const addDependent = (id: string, table: string, via: Dependent['via']) => {
    if (!id || ids.has(id)) return
    const rec = rows<{ id: string; root_id: string; is_erased: number }>(sql, 'SELECT id,root_id,is_erased FROM records WHERE id=?', id)[0]
    if (!rec || rec.is_erased) return
    const key = `${rec.root_id}\n${table}\n${via}`
    const dep = dependentByKey.get(key) ?? { root_id: rec.root_id, table, via, revision_ids: [], suggestion: 'review' as const }
    dep.revision_ids.push(...rootRevisions([rec.root_id]))
    dependentByKey.set(key, dep)
  }
  // Source lineages, child excerpts, citations, annotations and links.
  const sourceIds = new Set(primaryIds.filter(id => rows<{ kind: string | null }>(sql, 'SELECT kind FROM records WHERE id=?', id)[0]?.kind === 'sources'))
  for (const id of [...sourceIds]) {
    const root = rows<{ root_id: string }>(sql, 'SELECT root_id FROM records WHERE id=?', id)[0]?.root_id
    if (root) for (const sibling of rootRevisions([root])) sourceIds.add(sibling)
  }
  for (const id of [...sourceIds]) {
    const source = rows<{ original_text: string | null; provider: string | null; external_id: string | null }>(sql,
      'SELECT original_text,provider,external_id FROM sources WHERE id=?', id)[0]
    if (!source) continue
    const aliases = source.original_text
      ? rows<{ id: string }>(sql, 'SELECT id FROM sources WHERE original_text=? AND is_erased=0', source.original_text)
      : source.provider && source.external_id
        ? rows<{ id: string }>(sql, 'SELECT id FROM sources WHERE provider=? AND external_id=? AND is_erased=0', source.provider, source.external_id)
        : []
    for (const alias of aliases) {
      const aliasRoot = rows<{ root_id: string }>(sql, 'SELECT root_id FROM records WHERE id=?', alias.id)[0]?.root_id
      if (!aliasRoot || targetRoots.includes(aliasRoot)) continue
      addDependent(alias.id, 'sources', 'source')
      for (const revisionId of rootRevisions([aliasRoot])) sourceIds.add(revisionId)
    }
  }
  const childQueue = [...sourceIds]
  while (childQueue.length) {
    const batch = childQueue.splice(0, 80)
    for (const child of rows<{ id: string }>(sql, `SELECT id FROM sources WHERE parent_source_id IN (${batch.map(() => '?').join(',')})`, ...batch)) {
      if (!ids.has(child.id)) { addDependent(child.id, 'sources', 'child_excerpt'); sourceIds.add(child.id); childQueue.push(child.id) }
    }
  }
  for (const table of ['record_sources', 'annotations', 'record_links']) {
    const descriptor = descriptors[table]
    if (!descriptor) continue
    for (const col of descriptor.columns) {
      if (!col.references || col.references.table !== 'records' && col.references.table !== 'sources') continue
      const candidateIds = col.references.table === 'sources' ? [...sourceIds] : primaryIds
      for (let offset = 0; offset < candidateIds.length; offset += 80) {
        const batch = candidateIds.slice(offset, offset + 80)
        for (const row of rows<{ id: string }>(sql, `SELECT id FROM ${q(table)} WHERE ${q(col.name)} IN (${batch.map(() => '?').join(',')}) AND is_erased=0`, ...batch))
          addDependent(row.id, table, table === 'record_sources' ? 'record_source' : table === 'annotations' ? 'annotation' : 'link')
      }
    }
  }
  // Incoming references from every generated descriptor column, not a fixed room list.
  for (const descriptor of Object.values(descriptors)) for (const col of descriptor.columns) {
    if (!col.references) continue
    const candidateIds = col.references.table === 'sources' ? [...sourceIds] : primaryIds
    for (let offset = 0; offset < candidateIds.length; offset += 80) {
      const batch = candidateIds.slice(offset, offset + 80)
      for (const row of rows<{ id: string }>(sql, `SELECT id FROM ${q(descriptor.table)} WHERE ${q(col.name)} IN (${batch.map(() => '?').join(',')}) AND is_erased=0`, ...batch)) {
        const refId = batch.find(id => rows<{ hit: number }>(sql, `SELECT 1 AS hit FROM ${q(descriptor.table)} WHERE id=? AND ${q(col.name)}=?`, row.id, id).length > 0)
        const via = refId && sourceIds.has(refId) ? 'shared_source_consumer' : 'incoming_fk'
        addDependent(row.id, descriptor.table, via)
      }
    }
  }
  // Shared source consumers are explicit review items even when the citation table itself is selected.
  for (const sourceId of sourceIds) for (const consumer of rows<{ record_id: string }>(sql,
    'SELECT record_id FROM record_sources WHERE source_id=? AND is_erased=0', sourceId)) addDependent(consumer.record_id, 'records', 'shared_source_consumer')

  const roots = targetRoots.map(root_id => ({ root_id, revision_ids: sorted(rootRevisions([root_id])) }))
  const dependents = [...dependentByKey.values()].map(dep => ({ ...dep, revision_ids: sorted(dep.revision_ids) }))
    .sort((a, b) => `${a.root_id}\n${a.table}\n${a.via}`.localeCompare(`${b.root_id}\n${b.table}\n${b.via}`))
  const affectedIds = new Set([...primaryIds, ...dependents.flatMap(dep => dep.revision_ids)])
  const opSeqs = sorted([...affectedIds].flatMap(id => rows<{ op_seq: number }>(sql, 'SELECT op_seq FROM records WHERE id=?', id).map(row => String(row.op_seq))))
    .map(Number).sort((a, b) => a - b)
  const artifactUris = sorted([...sourceIds].flatMap(id => rows<{ artifact_uri: string | null }>(sql,
    'SELECT artifact_uri FROM sources WHERE id=? AND artifact_uri IS NOT NULL', id).flatMap(row => row.artifact_uri ? [row.artifact_uri] : [])))
  const records = rows<{ high: number }>(sql, 'SELECT COALESCE(MAX(op_seq),0) AS high FROM operations')[0]
  return { roots, dependents, recordIds: primaryIds, allRootIds: targetRoots, affectedOperationSeqs: opSeqs, artifactUris, highWater: records?.high ?? 0 }
}

async function closureHash(secret: string, closure: Closure): Promise<string> {
  const ids = sorted([...closure.recordIds, ...closure.dependents.flatMap(dep => dep.revision_ids), ...closure.allRootIds])
  const closureShape = { ids, edges: closure.dependents.map(({ root_id, table, via, revision_ids }) => ({ root_id, table, via, revision_ids })) }
  return sign(secret, `nova.erase.plan.v1\n${JSON.stringify(closureShape)}`)
}

export async function erasePrepare(ctx: Context, descriptors: DescriptorMap, control: ErasureControl, secret: string, input: unknown): Promise<PrepareReply> {
  const request = input as { targets?: unknown } | null
  if (!request || !validIds(request.targets)) return { ok: false, code: 'invalid_request' }
  try {
    const closure = computeEraseClosure(ctx.storage.sql, descriptors, request.targets)
    const [plan_hash, incarnation] = await Promise.all([closureHash(secret, closure), control.incarnation()])
    return { ok: true, plan_hash, incarnation, high_water: closure.highWater, roots: closure.roots, dependents: closure.dependents,
      artifact_uris_count: closure.artifactUris.length, affected_operation_seqs: closure.affectedOperationSeqs }
  } catch (error) {
    return { ok: false, code: error instanceof Error && error.message === 'already erased' ? 'already_erased' : 'erasure_list_unavailable' }
  }
}

function receiptFrom(operation: { op_seq: number; erasure_manifest: string; erasure_state: EraseReceipt['erasure_state']; backup_state: EraseReceipt['backup_state'] }, clientOpId: string): EraseReceipt {
  const manifest = JSON.parse(operation.erasure_manifest) as Omit<EraseReceipt, 'client_op_id' | 'erase_op_seq' | 'erasure_state' | 'backup_state'>
  return { client_op_id: clientOpId, erase_op_seq: operation.op_seq, ...manifest, erasure_state: operation.erasure_state, backup_state: operation.backup_state }
}

function token(secret: string, domain: string, value: string): Promise<string> { return sign(secret, `${domain}\n${value}`).then(hex => `v1:${hex}`) }
function safeFkCheck(sql: SQL): void { if (rows(sql, 'PRAGMA foreign_key_check').length) throw new Error('fk') }

function ensurePendingArtifacts(sql: SQL): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS pending_artifacts (
    artifact_id TEXT PRIMARY KEY, uri TEXT NOT NULL, client_op_id TEXT NOT NULL, created_at INTEGER NOT NULL
  )`)
}

async function finishErase(ctx: Context, control: ErasureControl, artifacts: ArtifactEraser,
  operation: { op_seq: number; client_op_id: string; erasure_manifest: string }): Promise<boolean> {
  assertStoreWritable(ctx.storage.sql)
  const manifest = JSON.parse(operation.erasure_manifest) as { affected_operation_seqs: number[] }
  const opIds = manifest.affected_operation_seqs.flatMap(seq => rows<{ client_op_id: string | null }>(ctx.storage.sql,
    'SELECT client_op_id FROM operations WHERE op_seq=? AND client_op_id IS NOT NULL', seq).flatMap(row => row.client_op_id ? [row.client_op_id] : []))
  const tokens = rows<{ blocked_source_tokens: string }>(ctx.storage.sql,
    'SELECT blocked_source_tokens FROM operations WHERE op_seq=?', operation.op_seq)[0]?.blocked_source_tokens
  await control.sealOperations(sorted([...opIds, operation.client_op_id]))
  await control.addSourceTokens(tokens ? JSON.parse(tokens) as string[] : [])

  const pending = rows<{ artifact_id: string; uri: string }>(ctx.storage.sql,
    'SELECT artifact_id,uri FROM pending_artifacts WHERE client_op_id=? ORDER BY artifact_id', operation.client_op_id)
  if (pending.length) {
    const result = await artifacts.deleteArtifacts(pending)
    const pendingIds = new Set(pending.map(item => item.artifact_id))
    const failedIds = new Set(result.failed)
    if (result.failed.some(id => !pendingIds.has(id)) || result.deleted + failedIds.size !== pending.length) throw new Error('artifact result')
    const confirmed = pending.filter(item => !failedIds.has(item.artifact_id))
    ctx.storage.transactionSync(() => {
      assertStoreWritable(ctx.storage.sql)
      for (const item of confirmed) ctx.storage.sql.exec('DELETE FROM pending_artifacts WHERE artifact_id=? AND client_op_id=?', item.artifact_id, operation.client_op_id)
    })
    if (failedIds.size) return false
  }
  ctx.storage.transactionSync(() => {
    assertStoreWritable(ctx.storage.sql)
    ctx.storage.sql.exec("UPDATE operations SET erasure_state='local_verified' WHERE op_seq=?", operation.op_seq)
  })
  return true
}

export async function eraseExecute(ctx: Context, descriptors: DescriptorMap, control: ErasureControl, artifacts: ArtifactEraser,
  secret: string, input: unknown): Promise<ExecuteReply> {
  try { assertStoreWritable(ctx.storage.sql) } catch (error) { return error instanceof EraseStoreBusy ? { ok: false, code: 'store_busy' } : { ok: false, code: 'storage_unavailable' } }
  const request = input as { client_op_id?: unknown; targets?: unknown; decisions?: unknown; plan_hash?: unknown } | null
  if (!request || typeof request.client_op_id !== 'string' || !uuidV4.test(request.client_op_id) || !validIds(request.targets) ||
    typeof request.plan_hash !== 'string' || !/^[0-9a-f]{64}$/.test(request.plan_hash) || !Array.isArray(request.decisions)) return { ok: false, code: 'invalid_request' }
  const decisions = request.decisions as Decision[]
  if (decisions.some(d => !d || !uuidV4.test(d.root_id) || !['erase', 'retain_nonrevealing'].includes(d.action))) return { ok: false, code: 'invalid_request' }
  const existing = rows<{ op_seq: number; erasure_manifest: string; erasure_state: EraseReceipt['erasure_state']; backup_state: EraseReceipt['backup_state'] }>(ctx.storage.sql,
    "SELECT op_seq,erasure_manifest,erasure_state,backup_state FROM operations WHERE client_op_id=? AND operation_kind='erase'", request.client_op_id)[0]
  if (existing?.erasure_state === 'local_verified') return receiptFrom(existing, request.client_op_id)
  if (existing) {
    try {
      ensurePendingArtifacts(ctx.storage.sql)
      const completed = await finishErase(ctx, control, artifacts, { ...existing, client_op_id: request.client_op_id })
      if (!completed) ctx.storage.transactionSync(() => {
        assertStoreWritable(ctx.storage.sql)
        ctx.storage.sql.exec("UPDATE operations SET erasure_state='failed' WHERE op_seq=?", existing.op_seq)
      })
    } catch (error) {
      if (error instanceof EraseStoreBusy) return { ok: false, code: 'store_busy' }
      ctx.storage.transactionSync(() => {
        assertStoreWritable(ctx.storage.sql)
        ctx.storage.sql.exec("UPDATE operations SET erasure_state='failed' WHERE op_seq=?", existing.op_seq)
      })
    }
    const retried = rows<{ op_seq: number; erasure_manifest: string; erasure_state: EraseReceipt['erasure_state']; backup_state: EraseReceipt['backup_state'] }>(ctx.storage.sql,
      'SELECT op_seq,erasure_manifest,erasure_state,backup_state FROM operations WHERE op_seq=?', existing.op_seq)[0]
    return retried ? receiptFrom(retried, request.client_op_id) : { ok: false, code: 'storage_unavailable' }
  }
  const priorErasure = request.targets.map(id => rows<{ is_erased: number; erasure_op_seq: number | null }>(ctx.storage.sql,
    'SELECT is_erased,erasure_op_seq FROM records WHERE id=?', id)[0]).find(row => row?.is_erased === 1)
  if (priorErasure?.erasure_op_seq) {
    const prior = rows<{ op_seq: number; client_op_id: string; erasure_manifest: string; erasure_state: EraseReceipt['erasure_state']; backup_state: EraseReceipt['backup_state'] }>(ctx.storage.sql,
      `SELECT o.op_seq,o.client_op_id,o.erasure_manifest,o.erasure_state,o.backup_state FROM operations o WHERE o.op_seq=? AND o.operation_kind='erase'`, priorErasure.erasure_op_seq)[0]
    if (prior) return receiptFrom(prior, prior.client_op_id)
  }
  if (rows(ctx.storage.sql, "SELECT client_op_id FROM operations WHERE client_op_id=? AND operation_kind<>'erase'", request.client_op_id).length) return { ok: false, code: 'invalid_request' }
  try {
    const closure = computeEraseClosure(ctx.storage.sql, descriptors, request.targets)
    if (await closureHash(secret, closure) !== request.plan_hash) return { ok: false, code: 'scope_changed' }
    const needDecisions = new Set(closure.dependents.map(dep => dep.root_id))
    const decisionRoots = decisions.map(decision => decision.root_id)
    if (new Set(decisionRoots).size !== decisionRoots.length || decisionRoots.length !== needDecisions.size ||
      [...needDecisions].some(root => !decisionRoots.includes(root))) return { ok: false, code: 'unresolved_dependents' }
    const dependentDecisions = decisions.slice().sort((a, b) => a.root_id.localeCompare(b.root_id))
    const selectedRoots = sorted([...closure.allRootIds, ...decisions.filter(d => d.action === 'erase').map(d => d.root_id)])
    const selectedIds = sorted(selectedRoots.flatMap(root => rows<{ id: string }>(ctx.storage.sql, 'SELECT id FROM records WHERE root_id=?', root).map(row => row.id)))
    const roots = sorted([...selectedRoots, ...selectedIds.map(id => rows<{ root_id: string }>(ctx.storage.sql, 'SELECT root_id FROM records WHERE id=?', id)[0]?.root_id ?? '')])
    const fence = await control.addErased(sorted([...selectedIds, ...roots]))
    if (!fence.ok) return { ok: false, code: 'erasure_list_unavailable' }
    ensurePendingArtifacts(ctx.storage.sql)
    await control.newIncarnation()
    const sourceTokenList: string[] = []
    const sourceValues = selectedIds.flatMap(id => rows<{ original_text: string | null; extracted_text: string | null; provider: string | null; external_id: string | null; artifact_uri: string | null }>(ctx.storage.sql,
      'SELECT original_text,extracted_text,provider,external_id,artifact_uri FROM sources WHERE id=?', id).flatMap(row => {
      const values: [string, string][] = []
      if (row.original_text) values.push(['nova.source.bytes.v1', row.original_text])
      if (row.extracted_text) values.push(['nova.source.bytes.v1', row.extracted_text])
      if (row.provider && row.external_id) values.push(['nova.source.identity.v1', `${row.provider}\n${row.external_id}`])
      if (row.artifact_uri) values.push(['nova.source.identity.v1', `artifact\n${row.artifact_uri}`])
      return values
    }))
    for (const [domain, value] of sourceValues) sourceTokenList.push(await token(secret, domain, value))
    const uris = sorted(selectedIds.flatMap(id => rows<{ artifact_uri: string | null }>(ctx.storage.sql,
      'SELECT artifact_uri FROM sources WHERE id=? AND artifact_uri IS NOT NULL', id).flatMap(row => row.artifact_uri ? [row.artifact_uri] : [])))
    const artifactPairs = uris.map(uri => ({ artifact_id: opaqueUuid(), uri }))
    const artifactIds = artifactPairs.map(item => item.artifact_id)
    const affectedIds = sorted([...closure.recordIds, ...closure.dependents.filter(dep => decisions.find(d => d.root_id === dep.root_id)?.action === 'erase').flatMap(dep => rows<{ id: string }>(ctx.storage.sql, 'SELECT id FROM records WHERE root_id=?', dep.root_id).map(row => row.id))])
    const affectedOperationSeqs = [...new Set([...closure.affectedOperationSeqs, ...affectedIds.flatMap(id => rows<{ op_seq: number }>(ctx.storage.sql, 'SELECT op_seq FROM records WHERE id=?', id).map(r => r.op_seq))])].sort((a,b)=>a-b)
    const clientOpId = request.client_op_id as string
    const manifest = { record_ids: selectedIds, root_ids: roots, affected_operation_seqs: affectedOperationSeqs,
      dependent_decisions: dependentDecisions.map(d => ({ root_id: d.root_id, action: d.action })), artifact_ids: artifactIds }
    const created = ctx.storage.transactionSync(() => {
      const sql = ctx.storage.sql
      assertStoreWritable(sql)
      let op = rows<{ op_seq: number; erasure_manifest: string; erasure_state: EraseReceipt['erasure_state']; backup_state: EraseReceipt['backup_state'] }>(sql,
        "SELECT op_seq,erasure_manifest,erasure_state,backup_state FROM operations WHERE client_op_id=? AND operation_kind='erase'", clientOpId)[0]
      if (!op) {
        sql.exec("INSERT INTO operations(client_op_id,operation_kind,retry_policy,request_digest,ingested_at,erasure_manifest,blocked_source_tokens,erasure_state,backup_state) VALUES (?,'erase','sealed',NULL,NULL,?,?, 'local_pending','expiry_pending')",
          clientOpId, JSON.stringify(manifest), JSON.stringify(sourceTokenList))
        op = rows<{ op_seq: number; erasure_manifest: string; erasure_state: EraseReceipt['erasure_state']; backup_state: EraseReceipt['backup_state'] }>(sql,
          'SELECT op_seq,erasure_manifest,erasure_state,backup_state FROM operations WHERE client_op_id=?', clientOpId)[0]
      }
      if (!op) throw new Error('op')
      const e = op.op_seq
      for (const artifact of artifactPairs) sql.exec('INSERT INTO pending_artifacts(artifact_id,uri,client_op_id,created_at) VALUES (?,?,?,?)',
        artifact.artifact_id, artifact.uri, clientOpId, Date.now())
      for (const id of selectedIds) sql.exec('UPDATE records SET is_current=0 WHERE id=?', id)
      sql.exec('PRAGMA defer_foreign_keys=ON')
      for (const id of selectedIds) {
        const row = rows<{ kind: string | null }>(sql, 'SELECT kind FROM records WHERE id=?', id)[0]
        let table = row?.kind
        if (!table) table = Object.values(descriptors).find(desc => payloadIds(sql, desc.table, [id]).length)?.table
        if (!table || !descriptors[table]) throw new Error('payload')
        const descriptor = descriptors[table]
        if (!descriptor) throw new Error('payload')
        const cols = descriptor.columns.map(col => `${q(col.name)}=NULL`).join(',')
        sql.exec(`UPDATE ${q(table)} SET ${cols},is_current=0,is_erased=1 WHERE id=?`, id)
        sql.exec(`UPDATE records SET is_current=0,is_erased=1,kind=NULL,erasure_op_seq=?,supersedes_id=NULL,change_kind='erased',change_reason=NULL,event_start_at=NULL,event_end_at=NULL,time_precision=NULL,reported_at=NULL,ingested_at=NULL,attribution_date=NULL,time_zone=NULL,attribution_basis=NULL,asserted_by=NULL,captured_by=NULL,client_op_id=NULL,deleted_at=NULL WHERE id=?`, e, id)
      }
      for (const seq of affectedOperationSeqs) sql.exec("UPDATE operations SET retry_policy='sealed',request_digest=NULL,ingested_at=NULL WHERE op_seq=? AND op_seq<>?", seq, e)
      sql.exec("UPDATE operations SET retry_policy='sealed',request_digest=NULL,ingested_at=NULL WHERE op_seq=?", e)
      safeFkCheck(sql)
      for (const id of selectedIds) {
        let count = 0
        for (const desc of Object.values(descriptors)) count += rows<{ n: number }>(sql,
          `SELECT COUNT(*) AS n FROM ${q(desc.table)} WHERE id=?`, id)[0]?.n ?? 0
        if (count !== 1) throw new Error('stub')
      }
      return rows<{ op_seq: number; erasure_manifest: string; erasure_state: EraseReceipt['erasure_state']; backup_state: EraseReceipt['backup_state'] }>(sql,
        'SELECT op_seq,erasure_manifest,erasure_state,backup_state FROM operations WHERE client_op_id=?', clientOpId)[0]
    })
    if (!created) return { ok: false, code: 'storage_unavailable' }
    try {
      const completed = await finishErase(ctx, control, artifacts, { ...created, client_op_id: clientOpId })
      if (!completed) ctx.storage.transactionSync(() => {
        assertStoreWritable(ctx.storage.sql)
        ctx.storage.sql.exec("UPDATE operations SET erasure_state='failed' WHERE client_op_id=?", clientOpId)
      })
    } catch (error) {
      if (error instanceof EraseStoreBusy) return { ok: false, code: 'store_busy' }
      ctx.storage.transactionSync(() => {
        assertStoreWritable(ctx.storage.sql)
        ctx.storage.sql.exec("UPDATE operations SET erasure_state='failed' WHERE client_op_id=?", clientOpId)
      })
    }
    const updated = rows<{ op_seq: number; erasure_manifest: string; erasure_state: EraseReceipt['erasure_state']; backup_state: EraseReceipt['backup_state'] }>(ctx.storage.sql,
      'SELECT op_seq,erasure_manifest,erasure_state,backup_state FROM operations WHERE client_op_id=?', clientOpId)[0]
    if (!updated) return { ok: false, code: 'storage_unavailable' }
    return receiptFrom(updated, clientOpId)
  } catch (error) {
    return error instanceof EraseStoreBusy ? { ok: false, code: 'store_busy' } : { ok: false, code: 'storage_unavailable' }
  }
}

export function eraseStatus(ctx: Context, clientOpId: unknown): EraseStatusReply {
  if (typeof clientOpId !== 'string' || !uuidV4.test(clientOpId)) return { ok: false, code: 'invalid_request' }
  try {
    const op = rows<{ op_seq: number; erasure_manifest: string; erasure_state: EraseReceipt['erasure_state']; backup_state: EraseReceipt['backup_state'] }>(ctx.storage.sql,
      "SELECT op_seq,erasure_manifest,erasure_state,backup_state FROM operations WHERE operation_kind='erase' AND client_op_id=?", clientOpId)[0]
    return op ? receiptFrom(op, clientOpId) : { ok: false, code: 'operation_not_found' }
  } catch { return { ok: false, code: 'storage_unavailable' } }
}
