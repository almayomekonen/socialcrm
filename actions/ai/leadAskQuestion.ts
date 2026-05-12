'use server'

import { requireAgencyUser } from '@/lib/requireUser'
import { runStructured, type RunStructuredImageAttachment } from '@/lib/ai/router'
import { resolveCopilotModeRole, isCopilotModeId, DEFAULT_COPILOT_MODE_ID } from '@/lib/ai/copilotModes'
import { persistAssistantTurn } from '@/lib/copilot/persistConversation'
import {
  LEAD_ASK_QUESTION_SYSTEM_PROMPT,
  LeadAskAnswer,
  LeadAskAnswerSchema,
  LeadQuestionAttachmentContext,
  LensId,
  buildLeadAskQuestionUserMessage,
  isLensId,
  sanitizeLeadAskAnswer,
} from '@/lib/ai/prompts/leadAskQuestion'
import { getFullLead } from '@/db/clients'
import { getLeadIntelligenceInputs } from '@/db/aiSummaries'
import { AiRunResult } from '@/lib/ai/types'
import { db } from '@/config/db'
import { s3PublicUrl } from '@/config/s3'
import {
  COPILOT_ATTACHMENT_PER_FILE_CHAR_CAP,
  COPILOT_ATTACHMENT_TOTAL_CHAR_CAP,
  COPILOT_MAX_ATTACHMENTS,
  COPILOT_MAX_LENSES,
  COPILOT_MAX_QUESTION_CHARS,
  COPILOT_MIN_QUESTION_CHARS,
  type CopilotAttachmentPayload,
  isCopilotImageMime,
  isCopilotTextMime,
} from '@/lib/copilot/attachments'

function normalizeQuestion(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().replace(/\s+/g, ' ')
  if (trimmed.length < COPILOT_MIN_QUESTION_CHARS || trimmed.length > COPILOT_MAX_QUESTION_CHARS) return null
  return trimmed
}

function normalizeLenses(raw: unknown): LensId[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<LensId>()
  for (const v of raw) {
    if (typeof v === 'string' && isLensId(v)) seen.add(v)
    if (seen.size >= COPILOT_MAX_LENSES) break
  }
  return Array.from(seen)
}

export async function askLeadQuestion(
  leadIdRaw: number | string,
  questionRaw: unknown,
  lensesRaw: unknown,
  attachmentsRaw: unknown = [],
  modeRaw: unknown = undefined,
): Promise<AiRunResult<LeadAskAnswer>> {
  const leadId = Number(leadIdRaw)
  if (!Number.isFinite(leadId) || leadId <= 0) {
    return { ok: false, reason: 'invalid-input' }
  }

  const question = normalizeQuestion(questionRaw)
  if (!question) {
    return { ok: false, reason: 'invalid-input' }
  }

  const lenses = normalizeLenses(lensesRaw)
  const rawAttachments = normalizeAttachmentPayloads(attachmentsRaw)
  const roleOverride = resolveCopilotModeRole(modeRaw)

  const user = await requireAgencyUser()

  if (process.env.AI_TRACE === '1') {
    // TEMPORARY [AI REQUEST] — emitted once per ask-question dispatch. Captures
    // the user-selected mode and the resolved role, so [AI ROUTER] /
    // [FALLBACK] downstream can be correlated. Remove with the AI_TRACE block
    // in lib/ai/router.ts after the mode-selector audit.
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

  const userMessage = buildLeadAskQuestionUserMessage({
    inputs: snapshot.inputs,
    leadName: (leadMeta.name as string) ?? null,
    question,
    lenses,
    attachments: promptAttachments,
  })

  if (process.env.NODE_ENV !== 'production' && process.env.COPILOT_TRACE === '1') {
    console.info('[copilot.trace] askLeadQuestion.payload', {
      leadId,
      question,
      lenses,
      attachmentsIn: rawAttachments.map((a) => ({
        fileId: a.fileId,
        kind: a.kind,
        name: a.name,
        mediaType: a.mediaType,
        size: a.size,
        contentChars: a.kind === 'text' ? a.content.length : undefined,
        truncated: a.kind === 'text' ? a.truncated : undefined,
      })),
      promptAttachments: promptAttachments.map((p) => ({
        kind: p.kind,
        name: p.name,
        mediaType: p.mediaType,
        contentChars: p.kind === 'text' ? p.content.length : undefined,
        partial: p.kind === 'text' ? p.partial : undefined,
        reason: p.kind === 'unreadable' ? p.reason : undefined,
      })),
      imageCount: imageAttachments.length,
      imageUrls: imageAttachments.map((i) => i.url),
      userMessageChars: userMessage.length,
      userMessagePreview: userMessage.slice(0, 800),
      userMessageTail: userMessage.slice(-400),
    })
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
  })

  const persistMode = isCopilotModeId(modeRaw) ? modeRaw : DEFAULT_COPILOT_MODE_ID

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

function normalizeAttachmentPayloads(raw: unknown): CopilotAttachmentPayload[] {
  if (!Array.isArray(raw)) return []

  const out: CopilotAttachmentPayload[] = []
  const seen = new Set<number>()

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const value = item as Record<string, unknown>
    const fileId = Number(value.fileId)
    if (!Number.isFinite(fileId) || fileId <= 0 || seen.has(fileId)) continue

    const name = normalizeString(value.name, 180)
    const mediaType = normalizeString(value.mediaType, 120)
    const size = Number(value.size)
    if (!name || !mediaType || !Number.isFinite(size) || size < 0) continue

    if (value.kind === 'text') {
      const content = normalizeString(value.content, COPILOT_ATTACHMENT_PER_FILE_CHAR_CAP)
      const originalChars = Number(value.originalChars)
      if (!content) continue
      out.push({
        kind: 'text',
        fileId,
        name,
        mediaType,
        size,
        content,
        truncated: value.truncated === true,
        originalChars: Number.isFinite(originalChars) && originalChars >= content.length ? originalChars : content.length,
      })
      seen.add(fileId)
    } else if (value.kind === 'image') {
      out.push({ kind: 'image', fileId, name, mediaType, size })
      seen.add(fileId)
    } else if (value.kind === 'unreadable') {
      const reason = normalizeUnreadableReason(value.reason)
      out.push({ kind: 'unreadable', fileId, name, mediaType, size, reason })
      seen.add(fileId)
    }

    if (out.length >= COPILOT_MAX_ATTACHMENTS) break
  }

  return out
}

function normalizeString(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

function normalizeUnreadableReason(raw: unknown): Extract<CopilotAttachmentPayload, { kind: 'unreadable' }>['reason'] {
  if (raw === 'unsupported-type' || raw === 'extraction-failed' || raw === 'empty-text') return raw
  return 'extraction-failed'
}

async function hydrateAttachments({
  rawAttachments,
  leadId,
  agencyId,
}: {
  rawAttachments: CopilotAttachmentPayload[]
  leadId: number
  agencyId: number
}): Promise<{ promptAttachments: LeadQuestionAttachmentContext[]; imageAttachments: RunStructuredImageAttachment[] }> {
  if (rawAttachments.length === 0) return { promptAttachments: [], imageAttachments: [] }

  const ids = rawAttachments.map((item) => item.fileId)
  const rows = await db('files')
    .whereIn('id', ids)
    .where({ agencyId, clientId: leadId })
    .select('id', 'name', 'type', 'size', 'path')

  const byId = new Map<number, { id: number; name: string; type: string; size: number; url: string | null }>()
  for (const row of rows) {
    const path = row.path ? String(row.path) : null
    byId.set(Number(row.id), {
      id: Number(row.id),
      name: String(row.name ?? ''),
      type: String(row.type ?? ''),
      size: Number(row.size ?? 0),
      url: path ? `${s3PublicUrl}${path}` : null,
    })
  }

  const promptAttachments: LeadQuestionAttachmentContext[] = []
  const imageAttachments: RunStructuredImageAttachment[] = []
  let remainingChars = COPILOT_ATTACHMENT_TOTAL_CHAR_CAP

  for (const attachment of rawAttachments) {
    const file = byId.get(attachment.fileId)
    if (!file) continue

    const base = {
      name: file.name || attachment.name,
      mediaType: file.type || attachment.mediaType,
      size: Number.isFinite(file.size) && file.size > 0 ? file.size : attachment.size,
    }

    if (attachment.kind === 'text') {
      if (!isCopilotTextMime(base.mediaType)) continue
      if (remainingChars <= 0) {
        promptAttachments.push({ kind: 'unreadable', ...base, reason: 'total-limit' })
        continue
      }

      const perFileContent = attachment.content.slice(0, COPILOT_ATTACHMENT_PER_FILE_CHAR_CAP)
      const content = perFileContent.slice(0, remainingChars)
      const partial =
        attachment.truncated || attachment.content.length > content.length || attachment.originalChars > content.length

      remainingChars -= content.length
      promptAttachments.push({
        kind: 'text',
        ...base,
        content,
        partial,
        originalChars: attachment.originalChars,
      })
      continue
    }

    if (attachment.kind === 'image') {
      if (!isCopilotImageMime(base.mediaType) || !file.url || !isHttpUrl(file.url)) continue
      promptAttachments.push({ kind: 'image', ...base })
      imageAttachments.push({ url: file.url, mediaType: base.mediaType, name: base.name })
      continue
    }

    promptAttachments.push({ kind: 'unreadable', ...base, reason: attachment.reason })
  }

  return { promptAttachments, imageAttachments }
}

function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
