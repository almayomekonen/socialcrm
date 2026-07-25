'use server'

import { requireProductAccess } from '@/lib/requireUser'
import { runStructured } from '@/lib/ai/router'
import { resolveCopilotModeRole, isCopilotModeId, DEFAULT_COPILOT_MODE_ID } from '@/lib/ai/copilotModes'
import { persistAssistantTurn } from '@/lib/copilot/persistConversation'
import {
  LEAD_ASK_QUESTION_SYSTEM_PROMPT,
  LeadAskAnswer,
  LeadAskAnswerSchema,
  buildLeadAskQuestionUserMessage,
  sanitizeLeadAskAnswer,
} from '@/lib/ai/prompts/leadAskQuestion'
import { getFullLead } from '@/db/clients'
import { getLeadIntelligenceInputs } from '@/db/aiSummaries'
import { isRuntimeCognitionEnabledForUser } from '@/lib/copilot/featureFlag'
import { getRuntimeCognitionForLead, formatRuntimeCognitionBlock } from '@/lib/copilot/general/runtimeCognition'
import { AiRunResult } from '@/lib/ai/types'
import { normalizeInput } from '@/lib/copilot/normalizeInput'
import { quickClassifyIntent } from '@/lib/copilot/quickClassifyIntent'
import { classifyIntentWithLLM } from '@/lib/copilot/intentClassifier'
import { isSocialIntent, type Intent } from '@/lib/copilot/intents'
import { pickConversationalReply } from '@/lib/copilot/conversationalIntent'
import type { ConversationalReply } from '@/lib/ai/prompts/conversationalReply'
import { normalizeAttachmentPayloads, normalizeLenses, normalizeQuestion } from './leadAskQuestion/normalize'
import { hydrateAttachments } from './leadAskQuestion/attachmentHydration'
import { injectAttachedDriveFiles } from './leadAskQuestion/driveContentFlow'

export async function askLeadQuestion(
  leadIdRaw: number | string,
  questionRaw: unknown,
  lensesRaw: unknown,
  attachmentsRaw: unknown = [],
  modeRaw: unknown = undefined,
): Promise<AiRunResult<LeadAskAnswer | ConversationalReply>> {
  const leadId = Number(leadIdRaw)
  if (!Number.isFinite(leadId) || leadId <= 0) return { ok: false, reason: 'invalid-input' }

  const question = normalizeQuestion(questionRaw)
  if (!question) return { ok: false, reason: 'invalid-input' }

  const lenses = normalizeLenses(lensesRaw)
  const rawAttachments = normalizeAttachmentPayloads(attachmentsRaw)
  const roleOverride = resolveCopilotModeRole(modeRaw)
  const copilotModeId = isCopilotModeId(modeRaw) ? modeRaw : undefined
  const persistMode = isCopilotModeId(modeRaw) ? modeRaw : DEFAULT_COPILOT_MODE_ID

  const user = await requireProductAccess()

  const normalizedQuestion = normalizeInput(question)
  let classification: { intent: Intent; confidence: number } = quickClassifyIntent(normalizedQuestion, question)

  if (classification.confidence < 0.9) {
    const llm = await classifyIntentWithLLM({
      normalizedText: normalizedQuestion,
      userId: user.id,
      agencyId: user.agencyId,
    })
    if (llm.ok) {
      classification = { intent: llm.intent, confidence: llm.confidence }
    }
  }

  if (isSocialIntent(classification.intent) && classification.confidence >= 0.9) {
    const startedAt = new Date()
    const reply = pickConversationalReply(classification.intent, question)
    const payload: ConversationalReply = { reply, intent: classification.intent }
    const result: AiRunResult<ConversationalReply> = {
      ok: true,
      data: payload,
      provider: 'internal',
      model: 'rule-based',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      latencyMs: 0,
    }
    await persistAssistantTurn<ConversationalReply>({
      agencyId: user.agencyId,
      leadId,
      userId: user.id,
      taskKind: 'lead.askQuestion',
      role: roleOverride,
      mode: persistMode,
      actionId: 'conversational',
      userText: question,
      attachments: [],
      lenses: [],
      structuredPayload: { actionId: 'conversational', data: payload },
      assistantSynopsis: reply,
      result,
      startedAt,
    })
    return result
  }

  if (process.env.AI_TRACE === '1') {
    console.info(
      '[AI REQUEST]',
      JSON.stringify({
        surface: 'copilot.askQuestion',
        mode: typeof modeRaw === 'string' ? modeRaw : null,
        role: roleOverride,
        leadId,
        agencyId: user.agencyId,
        questionChars: question.length,
        lensCount: lenses.length,
        attachmentCount: rawAttachments.length,
      }),
    )
  }

  const [snapshot, leadMeta] = await Promise.all([
    getLeadIntelligenceInputs(leadId).catch(() => null),
    getFullLead({ id: leadId, select: ['name'] }).catch(() => null),
  ])
  if (!snapshot || !leadMeta?.name) return { ok: false, reason: 'invalid-input' }

  const { promptAttachments, imageAttachments } = await hydrateAttachments({
    rawAttachments,
    leadId,
    agencyId: user.agencyId,
  })

  await injectAttachedDriveFiles({
    promptAttachments,
    leadId,
    agencyId: user.agencyId,
    userId: user.id,
  })

  let userMessage = buildLeadAskQuestionUserMessage({
    inputs: snapshot.inputs,
    leadName: (leadMeta.name as string) ?? null,
    question,
    lenses,
    attachments: promptAttachments,
  })

  if (isRuntimeCognitionEnabledForUser(user)) {
    try {
      const cognition = await getRuntimeCognitionForLead({ agencyId: user.agencyId }, leadId)
      const block = formatRuntimeCognitionBlock(cognition)
      if (block) userMessage = `${userMessage}\n\n${block}`
    } catch {
      // cognition is additive enrichment — never break the answer path
    }
  }

  const startedAt = new Date()
  const out = await runStructured({
    kind: 'lead.askQuestion',
    schema: LeadAskAnswerSchema,
    schemaName: 'LeadAskAnswer',
    schemaDescription: 'תשובה תפעולית לשאלת הנציג על ליד יחיד',
    system: LEAD_ASK_QUESTION_SYSTEM_PROMPT,
    user: userMessage,
    images: imageAttachments,
    leadId,
    agencyId: user.agencyId,
    roleOverride,
    copilotModeId,
  })

  if (out.ok === false) {
    await persistAssistantTurn<LeadAskAnswer>({
      agencyId: user.agencyId,
      leadId,
      userId: user.id,
      taskKind: 'lead.askQuestion',
      role: roleOverride,
      mode: persistMode,
      actionId: 'ask-question',
      userText: question,
      attachments: rawAttachments,
      lenses,
      result: out,
      startedAt,
    })
    return out
  }

  const { result, report } = sanitizeLeadAskAnswer(out.data)
  if (report.polluted) {
    console.warn(
      `[ai] sanitizer.askQuestion.pollution leadId=${leadId} fields=${report.fields.join(',')} sample=${report.sample}`,
    )
  }

  await persistAssistantTurn<LeadAskAnswer>({
    agencyId: user.agencyId,
    leadId,
    userId: user.id,
    taskKind: 'lead.askQuestion',
    role: roleOverride,
    mode: persistMode,
    actionId: 'ask-question',
    userText: question,
    attachments: rawAttachments,
    lenses,
    structuredPayload: { actionId: 'ask-question', data: result },
    assistantSynopsis: deriveAskAnswerSynopsis(result),
    result: { ...out, data: result },
    startedAt,
  })

  return { ...out, data: result }
}

function deriveAskAnswerSynopsis(result: LeadAskAnswer): string {
  const candidate = result as { answer?: unknown; summary?: unknown; message?: unknown }
  const value = candidate?.answer ?? candidate?.summary ?? candidate?.message
  return typeof value === 'string' ? value.slice(0, 200) : ''
}
