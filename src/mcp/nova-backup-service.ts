import { z } from 'zod'
import type { AuthenticatedIdentity } from '../contracts/store'
import { EXPORT_MAX_AGE_MS, verifyChunk, verifyManifest, type ExportManifest } from '../backup/manifest'
import type { WorkerBindings } from '../worker/config'
import { assertWritesEnabled, checkRate, resolveStoreForTools } from './guards'
import { readConfig } from '../worker/config'

export type BackupToolBindings = WorkerBindings & { BACKUPS?: R2Bucket | undefined; RETRY_HMAC_SECRET?: string | undefined }

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export const backupExportSchema = z.strictObject({ contract_version: z.literal('backup-1'), confirm: z.literal('EXPORT'),
  export_id: z.string().regex(uuidV4).optional(), cursor: z.string().max(128).optional() })
export const backupStatusSchema = z.strictObject({ contract_version: z.literal('backup-1') })
const MAX_EXPORT_STEPS_PER_CALL = 64

type SafeFailure = { ok: false; code: string }
const invalid = (): SafeFailure => ({ ok: false, code: 'invalid_params' })
function sizeOkay(input: unknown): boolean {
  try { return new TextEncoder().encode(JSON.stringify(input) ?? '').byteLength <= 16 * 1024 }
  catch { return false }
}
function exportCounts(manifest: ExportManifest): Record<string, number> {
  return Object.fromEntries(manifest.tables.map(table => [table.name, table.row_count]))
}

async function verifyExport(env: BackupToolBindings, physicalId: string, exportId: string) {
  if (!env.BACKUPS || !env.RETRY_HMAC_SECRET) return { manifest: null, verified: false }
  try {
    const prefix = `exports/${physicalId}/${exportId}/`
    const object = await env.BACKUPS.get(`${prefix}manifest.json`)
    if (!object) return { manifest: null, verified: false }
    const manifest = JSON.parse(await object.text()) as ExportManifest
    if (manifest.export_id !== exportId || !(await verifyManifest(env.RETRY_HMAC_SECRET, manifest))) return { manifest: null, verified: false }
    for (const table of manifest.tables) for (const chunk of table.chunks) {
      const body = await env.BACKUPS.get(chunk.key)
      if (!body || !(await verifyChunk(chunk, await body.text()))) return { manifest, verified: false }
    }
    return { manifest, verified: true }
  } catch { return { manifest: null, verified: false } }
}

export async function invokeBackupExport(env: BackupToolBindings, identity: AuthenticatedIdentity, input: unknown) {
  const enabled = assertWritesEnabled(env)
  if (!enabled.ok) return enabled.code === 'writes_disabled' ? enabled : { ok: false as const, code: 'storage_unavailable' }
  if (!sizeOkay(input)) return { ok: false as const, code: 'invalid_request' }
  const parsed = backupExportSchema.safeParse(input)
  if (!parsed.success) return invalid()
  const config = readConfig(env)
  if (!config.ok) return { ok: false as const, code: 'storage_unavailable' }
  const rate = await checkRate(env, identity, 'backup.export', config.value.NOVA_WRITE_RATE_PER_MIN)
  if (!rate.ok) return rate.code === 'rate_limited' ? rate : { ok: false as const, code: 'storage_unavailable' }
  try {
    const resolved = await resolveStoreForTools(env, identity)
    if (!resolved.ok) return { ok: false as const, code: 'storage_unavailable' }
    const { route } = resolved
    const ledger = env.LEDGER.get(env.LEDGER.idFromName(route.physicalId))
    const exportId = parsed.data.export_id ?? crypto.randomUUID().toLowerCase()
    let cursor = parsed.data.cursor
    if (parsed.data.export_id === undefined) {
      const started = await ledger.exportStart(route, { exportId })
      if (!started.ok) return { ok: false as const, code: started.code }
      cursor = started.cursor
    }
    for (let stepCount = 0; stepCount < MAX_EXPORT_STEPS_PER_CALL; stepCount++) {
      const step = await ledger.exportStep(route, { exportId, ...(cursor !== undefined ? { cursor } : {}) })
      if (!step.ok) return { ok: false as const, code: step.code }
      if (step.done) {
        const checked = await verifyExport(env, route.physicalId, exportId)
        const manifest = checked.manifest ?? ('manifest' in step ? step.manifest : undefined)
        if (!manifest) return { ok: false as const, code: 'manifest_unavailable' }
        return { ok: true as const, export_id: exportId, created_at: manifest.created_at, expires_at: manifest.expires_at,
          counts: exportCounts(manifest), chunk_count: manifest.tables.reduce((sum, table) => sum + table.chunks.length, 0),
          manifest_verified: checked.verified }
      }
      cursor = step.cursor ?? undefined
    }
    return { ok: true as const, export_id: exportId, state: 'running' as const, cursor: cursor ?? null,
      detail: 'Continue by calling backup.export with this export_id and cursor.' }
  } catch { return { ok: false as const, code: 'storage_unavailable' } }
}

export async function invokeBackupStatus(env: BackupToolBindings, identity: AuthenticatedIdentity, input: unknown) {
  if (!sizeOkay(input)) return { ok: false as const, code: 'invalid_request' }
  const parsed = backupStatusSchema.safeParse(input)
  if (!parsed.success) return invalid()
  const config = readConfig(env)
  if (!config.ok) return { ok: false as const, code: 'storage_unavailable' }
  const rate = await checkRate(env, identity, 'backup.status', config.value.NOVA_READ_RATE_PER_MIN)
  if (!rate.ok) return rate.code === 'rate_limited' ? rate : { ok: false as const, code: 'storage_unavailable' }
  if (!env.BACKUPS) return { ok: false as const, code: 'storage_unavailable' }
  try {
    const resolved = await resolveStoreForTools(env, identity)
    if (!resolved.ok) return { ok: false as const, code: 'storage_unavailable' }
    const prefix = `exports/${resolved.route.physicalId}/`
    const keys: string[] = []
    let cursor: string | undefined
    do {
      const page = await env.BACKUPS.list({ prefix, ...(cursor ? { cursor } : {}) })
      keys.push(...page.objects.map(object => object.key).filter(key => key.endsWith('/manifest.json')))
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)
    const exports: { export_id: string; created_at: string; expires_at: string; state: string; counts: Record<string, number> }[] = []
    for (const key of keys) {
      const object = await env.BACKUPS.get(key)
      if (!object) continue
      try {
        const manifest = JSON.parse(await object.text()) as ExportManifest
        if (!manifest.export_id || !manifest.created_at || !manifest.expires_at || !Array.isArray(manifest.tables)) continue
        exports.push({ export_id: manifest.export_id, created_at: manifest.created_at, expires_at: manifest.expires_at,
          state: Date.parse(manifest.expires_at) <= Date.now() ? 'expired' : 'complete', counts: exportCounts(manifest) })
      } catch { /* malformed manifests are not exposed */ }
    }
    exports.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    return { ok: true as const, exports: exports.slice(0, 20), retention_ms: EXPORT_MAX_AGE_MS,
      note: 'Exports expire after 30 days. Restore into a quarantine is an operator action, not a tool.' }
  } catch { return { ok: false as const, code: 'storage_unavailable' } }
}
