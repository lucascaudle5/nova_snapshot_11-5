import type { CallToolResult, McpServer } from '@modelcontextprotocol/server'
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server'
import type { AuthenticatedIdentity } from '../contracts/store'
import type { WorkerBindings } from '../worker/config'
import { invokeBackupExport, invokeBackupStatus, backupExportSchema, backupStatusSchema, type BackupToolBindings } from './nova-backup-service'
import { invokeErase, invokeErasePlan, invokeEraseStatus, erasePlanSchema, eraseSchema, eraseStatusSchema } from './nova-erase-service'

export interface OpsToolDependencies { env: WorkerBindings; identity: AuthenticatedIdentity }

function result(reply: object): CallToolResult {
  const content = reply as Record<string, unknown>
  return { isError: content.ok === false, structuredContent: content, content: [{ type: 'text', text: JSON.stringify(reply) }] }
}

export function registerOpsTools(server: McpServer, deps: OpsToolDependencies): void {
  const backupEnv = deps.env as BackupToolBindings
  registerAppTool(server, 'nova.erase_plan', {
    description: 'Prepare a plan without storing it; read the records, show the owner what will be erased, and get an explicit yes before calling nova.erase. Send one decision per distinct root_id in dependents, even when that root_id appears more than once.',
    inputSchema: erasePlanSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { visibility: ['model', 'app'] } }
  }, async (args: unknown): Promise<CallToolResult> => result(await invokeErasePlan(deps.env, deps.identity, args)))

  registerAppTool(server, 'nova.erase', {
    description: 'Erase only after the owner has explicitly said yes and you have shown what will be erased; pass the exact plan_hash and targets and one decision per distinct dependent root_id, then confirm ERASE. Reuse the same client_op_id on retry; a rejected call creates no operation, so nova.erase_status returns operation_not_found for it.',
    inputSchema: eraseSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { visibility: ['model', 'app'] } }
  }, async (args: unknown): Promise<CallToolResult> => result(await invokeErase(deps.env, deps.identity, args)))

  registerAppTool(server, 'nova.erase_status', {
    description: 'Read the safe receipt and current status for an erase operation. Pass erase-1 and its client_op_id.',
    inputSchema: eraseStatusSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { visibility: ['model', 'app'] } }
  }, async (args: unknown): Promise<CallToolResult> => result(await invokeEraseStatus(deps.env, deps.identity, args)))

  registerAppTool(server, 'backup.export', {
    description: 'Create or continue an owner-triggered manual export. Pass backup-1 and confirm EXPORT. A long export returns export_id and cursor; continue by calling this tool with the same export_id and cursor. The export remains in the account’s R2 bucket; no download link or chunk contents are returned.',
    inputSchema: backupExportSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { visibility: ['model', 'app'] } }
  }, async (args: unknown): Promise<CallToolResult> => result(await invokeBackupExport(backupEnv, deps.identity, args)))

  registerAppTool(server, 'backup.status', {
    description: 'List up to 20 of the owner’s exports, newest first. Exports expire after 30 days. Restore into a quarantine is an operator action, not a tool. No chunk contents or download links are available.',
    inputSchema: backupStatusSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { visibility: ['model', 'app'] } }
  }, async (args: unknown): Promise<CallToolResult> => result(await invokeBackupStatus(backupEnv, deps.identity, args)))
}
