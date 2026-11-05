import type { CallToolResult, McpServer } from '@modelcontextprotocol/server'
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server'
import { hostCheckInputSchema, describeInputSchema, invokeDescribe, invokeHostCheck, invokeRead, readInputSchema } from './nova-read-service'
import type { ReadToolDeps } from './nova-read-service'

function result(reply: Record<string, unknown> & { ok: boolean }): CallToolResult {
  return { isError: !reply.ok, structuredContent: reply,
    content: [{ type: 'text', text: JSON.stringify(reply) }] }
}

export function registerReadTools(server: McpServer, deps: ReadToolDeps): void {
  registerAppTool(server, 'nova.describe', {
    description: 'Discover read-1 views, their parameters and columns, coverage conventions, and available verbs.',
    inputSchema: describeInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { visibility: ['model', 'app'] } }
  }, async (args: unknown) => result(await invokeDescribe(deps.env, deps.identity, args)))

  registerAppTool(server, 'nova.read', {
    description: 'Run one catalogued read-1 view. Day-bound views accept local_date in America/Chicago instead of either bound; unknown values stay null.',
    inputSchema: readInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { visibility: ['model', 'app'] } }
  }, async (args: unknown) => result(await invokeRead(deps.env, deps.identity, args)))

  registerAppTool(server, 'host.check', {
    description: 'Check read access and report server timing and bytes for a fixed sample view.',
    inputSchema: hostCheckInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { visibility: ['model', 'app'] } }
  }, async (args: unknown) => result(await invokeHostCheck(deps.env, deps.identity, args)))
}
