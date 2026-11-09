import type { TaskKind } from '@/lib/ai/types'

/**
 * Who asked for an AI operation, for internal reporting (db/credits/report.ts).
 * The customer balance is touched only through agent_requests.
 *
 *   agent         an explicit request by the business owner or a rep.
 *   automation    background work. Never counted, never charged.
 *   unclassified  a kind not listed here: never charged, flagged in reporting.
 *
 * `Record<TaskKind, …>` makes a new task kind a compile error until it is
 * classified. A lead summary is `automation` even when a person is looking at
 * the page: it is generated on view and pre-warmed on lead changes, and nobody
 * asked for it.
 */
export type AiUsageCategory = 'agent' | 'automation' | 'unclassified'

const TASK_CATEGORY: Record<TaskKind, Exclude<AiUsageCategory, 'unclassified'>> = {
  'lead.summary': 'automation',
  'lead.classify': 'automation',
  'lead.followup': 'agent',
  'lead.nextStep': 'agent',
  'lead.askQuestion': 'agent',
  'pipeline.weekly': 'automation',
  'health.check': 'automation',
  'copilot.classifyIntent': 'agent',
  'copilot.generalReason': 'agent',
  'conversation.analysis': 'automation',
  'inbox.autoResponse': 'automation',
  'agent.investigate': 'agent',
}

/** Operations a worker or the Agent names itself (`withAiOperation`, `fallbackOperation`). */
const OPERATION_CATEGORY: Record<string, Exclude<AiUsageCategory, 'unclassified'>> = {
  wa_assistant_job: 'agent',
  copilot_request: 'agent',
  whatsapp_reply_draft: 'agent',
  agent_investigation: 'agent',
  'voice.transcribe': 'agent',
  auto_response_job: 'automation',
  conversation_analysis_job: 'automation',
}

const ALL: Record<string, Exclude<AiUsageCategory, 'unclassified'>> = { ...TASK_CATEGORY, ...OPERATION_CATEGORY }

export const aiUsageCategory = (kind: string): AiUsageCategory => ALL[kind] ?? 'unclassified'
