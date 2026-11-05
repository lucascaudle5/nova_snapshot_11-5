import type { CallToolResult, McpServer } from '@modelcontextprotocol/server'
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server'
import type { AuthenticatedIdentity } from '../contracts/store'
import type { WorkerBindings } from '../worker/config'
import {
  bodyLogWorkoutSchema, habitsLogSchema, invokeBodyLogWorkout, invokeHabitsLog, invokeMindLogEntry,
  invokeMindLogMedicationUse, invokeSchedulePlaceSignal, invokeWrite, mindLogEntrySchema,
  mindLogMedicationUseSchema, novaWriteSchema, schedulePlaceSignalSchema,
  focusStartSessionSchema, focusLogCheckpointSchema, focusEndSessionSchema,
  invokeFocusStartSession, invokeFocusLogCheckpoint, invokeFocusEndSession,
  learningLogPracticeAttemptSchema, learningLogHelpRequestSchema,
  invokeLearningLogPracticeAttempt, invokeLearningLogHelpRequest,
  musicLogInterpretationSchema, invokeMusicLogInterpretation
} from './nova-write-service'

export interface WriteToolDependencies {
  env: WorkerBindings
  identity: AuthenticatedIdentity
}

export function registerWriteTools(server: McpServer, deps: WriteToolDependencies): void {
  registerAppTool(server, 'nova.write', {
    description: 'Write records through NOVA’s validated, idempotent registry. Generate a fresh UUIDv4 client_op_id for each user action and reuse that exact ID and body on retry. Asserted_by may be user or model; captured_by is set by NOVA.',
    inputSchema: novaWriteSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { visibility: ['model', 'app'] } }
  }, async (args: unknown): Promise<CallToolResult> => {
    const reply = await invokeWrite(deps.env, deps.identity, args)
    return { isError: !reply.ok, structuredContent: reply, content: [{ type: 'text', text: JSON.stringify(reply) }] }
  })
  registerAppTool(server, 'habits.log', {
    description: 'Log one habit report. Use the exact current adopted habit name or any revision UUID; report status explicitly and keep unknown as unknown. said must contain the user’s words, or “tapped in the Habits page”. Generate a fresh UUIDv4 client_op_id for each user action and reuse the same ID and body on retry. The operation is idempotent.',
    inputSchema: habitsLogSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { visibility: ['model', 'app'] } }
  }, async (args: unknown): Promise<CallToolResult> => {
    const reply = await invokeHabitsLog(deps.env, deps.identity, args)
    return { isError: !reply.ok, structuredContent: reply, content: [{ type: 'text', text: JSON.stringify(reply) }] }
  })
  registerAppTool(server, 'body.log_workout', {
    description: 'Record one workout actual and all reported exercise sets atomically. Include the user’s words as evidence and reuse client_op_id on retry.',
    inputSchema: bodyLogWorkoutSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { visibility: ['model', 'app'] } }
  }, async (args: unknown): Promise<CallToolResult> => {
    const reply = await invokeBodyLogWorkout(deps.env, deps.identity, args)
    return { isError: !reply.ok, structuredContent: reply, content: [{ type: 'text', text: JSON.stringify(reply) }] }
  })
  registerAppTool(server, 'mind.log_entry', {
    description: 'Record one Mind entry and its quality ratings atomically. Rating values must match the selected quality scale. Reuse client_op_id on retry.',
    inputSchema: mindLogEntrySchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { visibility: ['model', 'app'] } }
  }, async (args: unknown): Promise<CallToolResult> => {
    const reply = await invokeMindLogEntry(deps.env, deps.identity, args)
    return { isError: !reply.ok, structuredContent: reply, content: [{ type: 'text', text: JSON.stringify(reply) }] }
  })
  registerAppTool(server, 'mind.log_medication_use', {
    description: 'Record one reported medication use status and optional experience. Reuse client_op_id on retry.',
    inputSchema: mindLogMedicationUseSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { visibility: ['model', 'app'] } }
  }, async (args: unknown): Promise<CallToolResult> => {
    const reply = await invokeMindLogMedicationUse(deps.env, deps.identity, args)
    return { isError: !reply.ok, structuredContent: reply, content: [{ type: 'text', text: JSON.stringify(reply) }] }
  })
  registerAppTool(server, 'schedule.place_signal', {
    description: 'Place an open Schedule signal into an adopted block and update its disposition atomically. Reuse client_op_id on retry.',
    inputSchema: schedulePlaceSignalSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { visibility: ['model', 'app'] } }
  }, async (args: unknown): Promise<CallToolResult> => {
    const reply = await invokeSchedulePlaceSignal(deps.env, deps.identity, args)
    return { isError: !reply.ok, structuredContent: reply, content: [{ type: 'text', text: JSON.stringify(reply) }] }
  })
  for (const tool of [
    {name:'focus.start_session',description:'Start one Focus session and its sourced start event atomically.',inputSchema:focusStartSessionSchema,invoke:invokeFocusStartSession},
    {name:'focus.log_checkpoint',description:'Record supplied done, happened, unresolved, and next statements as sourced Focus events. Omitted parts are not written.',inputSchema:focusLogCheckpointSchema,invoke:invokeFocusLogCheckpoint},
    {name:'focus.end_session',description:'Record the owner reported Focus outcome against the current session.',inputSchema:focusEndSessionSchema,invoke:invokeFocusEndSession},
    {name:'learning.log_practice_attempt',description:'Record the learner supplied practice response and status.',inputSchema:learningLogPracticeAttemptSchema,invoke:invokeLearningLogPracticeAttempt},
    {name:'learning.log_help_request',description:'Record the owner’s help request and selected mode. This tool does not generate a response.',inputSchema:learningLogHelpRequestSchema,invoke:invokeLearningLogHelpRequest},
    {name:'music.log_interpretation',description:'Record the owner’s own interpretation of a track as user asserted.',inputSchema:musicLogInterpretationSchema,invoke:invokeMusicLogInterpretation}
  ] as const) {
    registerAppTool(server,tool.name,{
      description:`${tool.description} Reuse client_op_id exactly on retry.`,inputSchema:tool.inputSchema,
      annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false},
      _meta:{ui:{visibility:['model','app']}}
    },async(args:unknown):Promise<CallToolResult>=>{
      const reply=await tool.invoke(deps.env,deps.identity,args)
      return {isError:!reply.ok,structuredContent:reply,content:[{type:'text',text:JSON.stringify(reply)}]}
    })
  }
}
