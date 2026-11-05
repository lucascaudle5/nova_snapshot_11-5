import { McpServer } from '@modelcontextprotocol/server'
import type { CallToolResult } from '@modelcontextprotocol/server'
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import { createMcpHandler } from 'agents/mcp/server'
import type { AuthenticatedHandler } from '../auth/application'
import { BUILD, RESOURCE_URI } from '../contracts/compat'
import { invokeNavigation, invokeShell } from './navigation-service'
import { shellOpenSchema, navigateSchema, pollSchema } from '../contracts/navigation'
import { registerReadTools } from './register-read'
import { registerWriteTools } from './register-write'
import { registerOpsTools } from './register-ops'
import widgetHtml from '../../dist/widget-resource'

export const serveMcp: AuthenticatedHandler = (request, env, ctx, identity) => createMcpHandler(() => {
  const server = new McpServer({ name: 'NOVA', version: BUILD })
  const resourceMeta = { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: false } }
  registerAppResource(server, 'NOVA shell', RESOURCE_URI, { _meta: resourceMeta }, () => ({
    contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: widgetHtml, _meta: resourceMeta }]
  }))
  registerAppTool(server, 'nova.open', { description: 'Open the NOVA shell at home or the requested room. Pass contract_version shell-1 and a store. Only home is built; other rooms show “Not built yet”.', inputSchema: shellOpenSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ['model', 'app'] } }
  }, async (args: unknown): Promise<CallToolResult> => {
    const reply = await invokeShell(env, identity, args)
    return { isError: !reply.ok, structuredContent: reply, content: [{ type: 'text', text: reply.ok ? 'NOVA opened.' : `NOVA: ${reply.code}.` }] }
  })
  for (const method of ['navigate', 'poll'] as const) registerAppTool(server, method === 'navigate' ? 'navigate' : 'view.poll', {
    description: method === 'navigate' ? 'Update the existing NOVA card. Pass shell-1, store_handle and a room. Unbuilt rooms show “Not built yet”.' : 'App-only visible-card check-in. Pass shell-1, store_handle, UUID card_id and last_seen_sequence. Apply each newer view once; stop if inactive or hidden.',
    inputSchema: method === 'navigate' ? navigateSchema : pollSchema,
    annotations: { readOnlyHint: method === 'poll', destructiveHint: false, openWorldHint: false },
    _meta: { ui: { visibility: method === 'poll' ? ['app'] : ['model', 'app'] } }
  }, async (args: unknown): Promise<CallToolResult> => {
    const reply = await invokeNavigation(env, identity, method, args)
    return { isError: !reply.ok, ...(method === 'poll' ? { structuredContent: reply } : {}), content: [{ type: 'text', text: JSON.stringify(reply) }] }
  })
  registerReadTools(server, { env, identity })
  registerWriteTools(server, { env, identity })
  registerOpsTools(server, { env, identity })
  return server
})(request, env, ctx)
