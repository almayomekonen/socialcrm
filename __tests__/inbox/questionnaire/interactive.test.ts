/**
 * Tap-to-select — the pure rules: which format fits Meta's limits, the payload
 * shape, stable ids, the text/interactive fallback, and how a tap is read.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  buildInteractive,
  interactiveBody,
  interactiveSender,
  parseSelectionId,
  planInteractive,
  tappedSelectionId,
} from '@/lib/inbox/autoresponse/questionnaire/interactive'
import { decideQuestionnaireTurn } from '@/lib/inbox/autoresponse/questionnaire/transition'
import { parseQuestionnaireDefinition } from '@/lib/inbox/autoresponse/questionnaire/definition'
import { parseWhatsappMessage } from '@/lib/adapters/whatsappMessage'
import { renderQuestion } from '@/lib/inbox/autoresponse/questionnaire/render'

const choice = (labels: string[], extra: Record<string, unknown> = {}) =>
  ({
    id: 'q',
    type: 'choice',
    label: 'שאלה',
    prompt: 'מה בוחרים?',
    options: labels.map((label, i) => ({ id: `o${i + 1}`, label })),
    ...extra,
  }) as never

describe('planInteractive — Meta limits', () => {
  it('≤3 options with titles ≤20 chars → reply buttons', () => {
    expect(planInteractive(choice(['כן', 'לא']))?.kind).toBe('button')
    expect(planInteractive(choice(['a'.repeat(20), 'b', 'c']))?.kind).toBe('button')
  })

  it('a title over 20 chars, or 4–10 options → a list', () => {
    expect(planInteractive(choice(['a'.repeat(21), 'b']))?.kind).toBe('list')
    expect(planInteractive(choice(['1', '2', '3', '4']))?.kind).toBe('list')
    expect(planInteractive(choice(Array.from({ length: 10 }, (_, i) => `אפשרות ${i}`)))?.kind).toBe('list')
  })

  it('multi-select, free text and no step stay numbered text', () => {
    expect(planInteractive(choice(['a', 'b'], { multi: true }))).toBeNull()
    expect(planInteractive({ id: 't', type: 'text', label: 'x', prompt: 'x' } as never)).toBeNull()
    expect(planInteractive(null)).toBeNull()
  })
})

describe('payload', () => {
  const step = choice(['כן', 'לא'])

  it('buttons carry <stepId>.<optionId> ids and the labels as titles; the body drops the numbered lines', () => {
    const body = interactiveBody(renderQuestion(step), step)
    expect(body).toBe('מה בוחרים?\n\nלשיחה עם נציג כתבו: נציג')
    expect(buildInteractive({ kind: 'button', step }, body)).toEqual({
      type: 'button',
      body: { text: body },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'q.o1', title: 'כן' } },
          { type: 'reply', reply: { id: 'q.o2', title: 'לא' } },
        ],
      },
    })
  })

  it('a list has its button text (≤20) and one titled section (≤24)', () => {
    const list = choice(['1', '2', '3', '4'])
    const payload = buildInteractive({ kind: 'list', step: list }, 'גוף') as any
    expect(payload.action.button.length).toBeLessThanOrEqual(20)
    expect(payload.action.sections).toHaveLength(1)
    expect(payload.action.sections[0].title.length).toBeLessThanOrEqual(24)
    expect(payload.action.sections[0].rows[3]).toEqual({ id: 'q.o4', title: '4' })
  })

  it('a body over the format limit does not fit (→ numbered text)', () => {
    expect(buildInteractive({ kind: 'button', step }, 'x'.repeat(1025))).toBeNull()
    expect(buildInteractive({ kind: 'list', step: choice(['1', '2', '3', '4']) }, 'x'.repeat(4097))).toBeNull()
  })
})

describe('interactiveSender — fallback', () => {
  const step = choice(['כן', 'לא'])
  const plan = { kind: 'button' as const, step }
  const args = { phoneNumberId: 'p', accessToken: 't', to: '972500000000', body: renderQuestion(step) }

  it('sends interactive when Meta accepts it', async () => {
    const sendText = vi.fn()
    const sendInteractive = vi.fn(async () => ({ ok: true as const, wamid: 'w' }))
    await expect(interactiveSender(plan, { sendText, sendInteractive })(args)).resolves.toEqual({ ok: true, wamid: 'w' })
    expect(sendText).not.toHaveBeenCalled()
  })

  it('falls back to the same numbered text when Meta rejects it', async () => {
    const sendText = vi.fn(async () => ({ ok: true as const, wamid: 't' }))
    const sendInteractive = vi.fn(async () => ({ ok: false as const, error: 'bad', code: '100', httpStatus: 400 }))
    await interactiveSender(plan, { sendText, sendInteractive })(args)
    expect(sendText).toHaveBeenCalledWith(args)
  })

  it('never sends a second copy after an ambiguous failure', async () => {
    const sendText = vi.fn()
    const sendInteractive = vi.fn(async () => ({ ok: false as const, error: 'send-timeout', ambiguous: true }))
    const r = await interactiveSender(plan, { sendText, sendInteractive })(args)
    expect(r).toMatchObject({ ok: false, ambiguous: true })
    expect(sendText).not.toHaveBeenCalled()
  })
})

describe('reading a tap', () => {
  it('the inbound parser puts the tapped title in text; the id stays in payload', () => {
    const parsed = parseWhatsappMessage({
      id: 'wamid.x',
      type: 'interactive',
      interactive: { type: 'list_reply', list_reply: { id: 'q.o2', title: 'לא' } },
    })
    expect(parsed.text).toBe('לא')
    expect(tappedSelectionId(parsed.type, parsed.payload)).toBe('q.o2')
  })

  it('selection ids parse only in the <stepId>.<optionId> shape', () => {
    expect(parseSelectionId('event_type.wedding')).toEqual({ stepId: 'event_type', optionId: 'wedding' })
    expect(parseSelectionId('wedding')).toBeNull()
    expect(parseSelectionId('a.b.c')).toBeNull()
    expect(parseSelectionId(undefined)).toBeNull()
  })

  it('a tapped option labelled "נציג" is an answer, not a request for a person', () => {
    const def = parseQuestionnaireDefinition({
      schemaVersion: 1, revision: 1, language: 'he', welcome: 'שלום', closing: 'תודה', handoff: 'מעבירים לנציג',
      summaryTitle: 'סיכום', maxInvalidAttempts: 2, expireAfterHours: 24,
      steps: [
        { id: 'who', type: 'choice', label: 'עם מי', prompt: 'עם מי לדבר?', options: [{ id: 'bot', label: 'בוט' }, { id: 'rep', label: 'נציג' }] },
        { id: 'name', type: 'text', label: 'שם', prompt: 'איך קוראים לך?' },
      ],
    })
    if (!parsed(def)) throw new Error('definition invalid')
    const decision = decideQuestionnaireTurn({
      definition: def.definition,
      session: { id: 1, status: 'active', currentStepId: 'who', answers: {}, invalidCount: 0, lastPromptAt: new Date(), version: 1 } as never,
      inputs: [{ sequence: 5, kind: 'text', text: 'נציג', selectedId: 'who.rep' }],
      now: new Date(),
      routedToQuestionnaire: true,
      aiState: 'ai_qualifying' as never,
      humanTookOver: false,
      hasPriorOutbound: true,
      leadStatusTerminal: false,
    })
    expect(decision.kind).toBe('question')
    expect(decision.kind === 'question' && decision.answers.who).toEqual(['rep'])
  })
})

function parsed(r: ReturnType<typeof parseQuestionnaireDefinition>): r is Extract<typeof r, { ok: true }> {
  return r.ok === true
}
