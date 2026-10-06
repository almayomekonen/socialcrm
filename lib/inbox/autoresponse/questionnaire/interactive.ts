/**
 * Tap-to-select for the questionnaire: a choice question as WhatsApp reply
 * buttons or a list, with the numbered text menu as the fallback.
 *
 * LIMITS, from Meta's reference (checked 2026-09-28):
 *   reply buttons  https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-reply-buttons-messages
 *                  ≤3 buttons · title ≤20 chars, unique · id ≤256 · body ≤1024
 *   list           https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-list-messages
 *                  ≤10 rows in total · row title ≤24 · row id ≤200 · button ≤20
 *                  · section title ≤24 and required · body ≤4096
 * Both are single-select and are free-form (session) messages, sent only inside
 * the 24-hour window the worker already checks.
 *
 * WHAT STAYS TEXT: multi-select questions (an interactive reply is one choice),
 * free-text questions, anything that does not fit the limits, and every
 * business outside `canUseQuestionnaireInteractive`.
 *
 * STABLE IDS: an option is sent as `<stepId>.<optionId>` — the definition's own
 * ids, validated `[a-z0-9_]{1,40}` — so a tap is resolved by id, never by the
 * label text, and a tap on an earlier question can be recognised as stale.
 *
 * NO MODEL is involved anywhere here (noLlm.test.ts walks this import graph).
 */
import {
  sendWhatsappInteractive,
  type SendWhatsappArgs,
  type SendWhatsappTextFailure,
  type SendWhatsappTextResult,
} from '@/lib/whatsapp/sendMessage'
import type { QuestionnaireStep } from './definition'
import { menuLine } from './render'

const BUTTON_MAX = 3
const BUTTON_TITLE_MAX = 20
const BUTTON_BODY_MAX = 1024
const LIST_ROWS_MAX = 10
const LIST_ROW_TITLE_MAX = 24
const LIST_BODY_MAX = 4096
/** Shown on the list's open button (≤20) and as its one section title (≤24). */
export const LIST_BUTTON_TEXT = 'בחירת תשובה'
export const LIST_SECTION_TITLE = 'אפשרויות'

export type InteractivePlan = {
  kind: 'button' | 'list'
  step: Extract<QuestionnaireStep, { type: 'choice' }>
}

/** Which interactive format this question fits, or null for numbered text. */
export function planInteractive(step: QuestionnaireStep | null | undefined): InteractivePlan | null {
  if (!step || step.type !== 'choice' || step.multi === true) return null
  const labels = step.options.map((o) => o.label)
  if (labels.length <= BUTTON_MAX && labels.every((l) => l.length <= BUTTON_TITLE_MAX)) return { kind: 'button', step }
  if (labels.length <= LIST_ROWS_MAX && labels.every((l) => l.length <= LIST_ROW_TITLE_MAX)) return { kind: 'list', step }
  return null
}

export function selectionId(stepId: string, optionId: string): string {
  return `${stepId}.${optionId}`
}

/** `<stepId>.<optionId>` back into its parts; null for anything else. */
export function parseSelectionId(id: string | null | undefined): { stepId: string; optionId: string } | null {
  const m = typeof id === 'string' ? /^([a-z0-9_]{1,40})\.([a-z0-9_]{1,40})$/.exec(id) : null
  return m ? { stepId: m[1], optionId: m[2] } : null
}

/**
 * The message text without its numbered option lines — the buttons or the list
 * replace them. The prompt, any reprompt line and the "נציג" hint stay.
 */
export function interactiveBody(text: string, step: Extract<QuestionnaireStep, { type: 'choice' }>): string {
  const optionLines = new Set(step.options.map((o, i) => menuLine(o, i)))
  return text
    .split('\n')
    .filter((line) => !optionLines.has(line.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Meta's `interactive` object for this plan and body, or null when it does not fit. */
export function buildInteractive(plan: InteractivePlan, body: string): Record<string, unknown> | null {
  const { step } = plan
  if (!body) return null
  if (plan.kind === 'button') {
    if (body.length > BUTTON_BODY_MAX) return null
    return {
      type: 'button',
      body: { text: body },
      action: {
        buttons: step.options.map((o) => ({ type: 'reply', reply: { id: selectionId(step.id, o.id), title: o.label } })),
      },
    }
  }
  if (body.length > LIST_BODY_MAX) return null
  return {
    type: 'list',
    body: { text: body },
    action: {
      button: LIST_BUTTON_TEXT,
      sections: [
        { title: LIST_SECTION_TITLE, rows: step.options.map((o) => ({ id: selectionId(step.id, o.id), title: o.label })) },
      ],
    },
  }
}

type TextSend = (args: SendWhatsappArgs) => Promise<SendWhatsappTextResult>

/**
 * A send function with the same contract as `sendWhatsappText`, for
 * `sendIreOutbound`: it receives the numbered text (which is what gets stored,
 * so the rep's inbox shows the question with its options) and sends the
 * interactive form of it.
 *
 * FALLBACK: when Meta rejects the interactive message, the same question is
 * sent once as numbered text. Never after an AMBIGUOUS failure (a timeout): the
 * interactive message may already be on the customer's phone, and the worker's
 * own rule — park it and hand it to a person — must apply.
 */
export function interactiveSender(
  plan: InteractivePlan,
  deps: { sendText: TextSend; sendInteractive?: typeof sendWhatsappInteractive },
): TextSend {
  const sendInteractive = deps.sendInteractive ?? sendWhatsappInteractive
  return async (args) => {
    const interactive = buildInteractive(plan, interactiveBody(args.body, plan.step))
    if (!interactive) return deps.sendText(args)
    const sent = await sendInteractive({ ...args, interactive })
    if (sent.ok === true) return sent
    const failure = sent as SendWhatsappTextFailure
    if (failure.ambiguous) return failure
    console.warn('[questionnaire] interactive rejected, sending numbered text', {
      code: failure.code,
      subcode: failure.subcode,
      stepId: plan.step.id,
    })
    return deps.sendText(args)
  }
}

/** The option id a customer tapped, from a stored inbound `interactive` payload. */
export function tappedSelectionId(type: string, payload: unknown): string | null {
  if (type !== 'interactive' || !payload || typeof payload !== 'object') return null
  const p = (typeof payload === 'string' ? safeJson(payload) : payload) as {
    button_reply?: { id?: unknown }
    list_reply?: { id?: unknown }
  } | null
  const id = p?.button_reply?.id ?? p?.list_reply?.id
  return typeof id === 'string' && id ? id : null
}

function safeJson(v: string): unknown {
  try {
    return JSON.parse(v)
  } catch {
    return null
  }
}
