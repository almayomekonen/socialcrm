import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

/**
 * "בדקו את הסוכן שלכם" must have NO production side effects.
 *
 * This is a static guard, in the spirit of `agentSendGuardCoverage`: the risk is
 * that a future edit adds a convenient write — "persist the preview so the owner
 * can come back to it" — and a test conversation starts creating leads or, far
 * worse, sending WhatsApp. Asserting on behaviour alone would not catch that;
 * asserting that the module never imports a writer does.
 */

const PREVIEW = 'actions/autoResponse/previewAgent.ts'

/** Every way this codebase reaches a customer or mutates durable CRM state. */
const FORBIDDEN_IMPORTS: Array<[RegExp, string]> = [
  [/sendWhatsappText|sendWhatsappTemplate|lib\/whatsapp\/sendMessage/, 'sends WhatsApp'],
  [/persistOutboundWhatsapp|ingestWhatsappInbound/, 'writes inbox messages'],
  [/findOrCreateConversation|inboxConversations/, 'writes conversations'],
  [/createLeadFromWhatsappWebhook|promoteConversationToLead/, 'creates leads'],
  [/enqueueAutoResponse|autoResponseJobs|kickWorker|runAutoResponseWorker/, 'enqueues or runs jobs'],
  [/notifyEvent|lib\/notifications\/emit/, 'emits notifications'],
  [/recordTurn|markEscalated|markHumanActive|markStopped|markClosed|conversationAiState/, 'writes AI state'],
  [/insertQualifyDraftReview|recordTurnClassification|conversationIntelligence/, 'writes analysis rows'],
  [/runImmediateHumanHandoff|sendIreOutbound|postHandoff/, 'triggers a live handoff'],
  [/scheduleNoResponseWarning/, 'schedules follow-up jobs'],
]

describe('the preview cannot reach production', () => {
  const src = read(PREVIEW)

  for (const [pattern, what] of FORBIDDEN_IMPORTS) {
    it(`never ${what}`, () => {
      const offending = src
        .split('\n')
        .filter((line) => pattern.test(line))
        .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
      expect(offending, `${PREVIEW} ${what}:\n${offending.join('\n')}`).toEqual([])
    })
  }

  it('performs no database write of any kind', () => {
    // It reads settings and the agency name; it must never insert or update.
    expect(src).not.toMatch(/\.insert\(|\.update\(|\.del\(|\.delete\(/)
  })

  it('is admin-gated and agency-scoped like every other settings action', () => {
    expect(src).toContain('requireProductAccess()')
    expect(src).toContain('isAdmin(user.role)')
    expect(src).toContain('user.agencyId')
    // The agencyId is never taken from the request.
    expect(src).not.toMatch(/input\.agencyId|args\.agencyId/)
  })
})

describe('the preview runs the same decisions as the live agent', () => {
  const src = read(PREVIEW)

  it('reuses the real prompt construction, not a copy', () => {
    for (const shared of [
      'formatBusinessIdentityBlock',
      'groundedFactsFor',
      'generateQualifyTurn',
      'classifySalesTurnFromTranscript',
      'decideConversationControl',
      'decideGreeting',
      'validateAutoResponse',
      'questionPolicyForSalesMove',
    ]) {
      expect(src, `preview does not use ${shared}`).toContain(shared)
    }
  })

  it('honours opt-out and human requests with the same detectors', () => {
    expect(src).toContain('detectOptOut')
    expect(src).toContain('detectHumanRequest')
  })

  it('falls back the same way when a reply fails validation', () => {
    expect(src).toContain('deterministicQualifyFallback')
    expect(src).toContain('safeFallbackReply')
  })
})

describe('the preview UI states what it is', () => {
  const ui = read('components/settings/autoResponse/AgentPreview.tsx')

  it('says plainly that nothing is sent', () => {
    expect(ui).toContain('לא נשלחת הודעה בוואטסאפ, לא נוצר ליד, ואף אחד מהצוות לא מקבל התראה')
  })

  it('distinguishes unsaved draft from saved settings', () => {
    expect(ui).toContain('נבדק לפי הטקסט שכתבתם עכשיו ועדיין לא שמרתם')
    expect(ui).toContain('נבדק לפי ההגדרות השמורות')
  })

  it('offers a fresh conversation and a way out', () => {
    expect(ui).toContain('שיחה חדשה')
    expect(ui).toContain('בדקו את הסוכן שלכם')
  })

  it('shows a reason rather than an empty bubble when the agent would stay silent', () => {
    expect(ui).toContain('הסוכן לא היה שולח כלום כאן')
  })

  it('handles loading and errors', () => {
    expect(ui).toContain('הסוכן מקליד…')
    expect(ui).toContain("role='alert'")
    expect(ui).toContain('ERROR_COPY')
  })

  it('is RTL and reachable by keyboard', () => {
    expect(ui).toContain("dir='rtl'")
    expect(ui).toContain("aria-label='הודעה כלקוח'")
    expect(ui).toContain("e.key === 'Enter'")
  })
})

describe('the setup flow asks for one thing', () => {
  const style = read('components/settings/autoResponse/AutoResponseReplyStyle.tsx')

  it('uses the approved label, helper and example', () => {
    expect(style).toContain('ספרו לסוכן על העסק ומה תרצו שיעשה')
    expect(style).toContain('הסוכן ישתמש במידע כדי לענות ולנהל שיחה בשם העסק')
    expect(style).toContain('אנחנו מוסך בחולון, פתוחים א׳–ה׳ 8:00–17:00')
  })

  it('keeps Fixed Message exactly as it was', () => {
    expect(style).toContain("label='ההודעה שתישלח'")
    expect(style).toContain('{{firstName}}')
    expect(style).toContain('sent\n')
  })

  it('hides the optional instruction field behind Advanced', () => {
    expect(style).toContain('הגדרות מתקדמות')
    expect(style).toContain('aria-expanded={advancedOpen}')
    expect(style).toContain('advancedOpen && (')
  })

  it('exposes no prompts, stages, schemas or turn counts', () => {
    // Comments explain the design and are not rendered; strip them so this
    // asserts what the owner actually sees rather than how it was built.
    const rendered = style
      .split('\n')
      .filter((line) => {
        const t = line.trim()
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
      })
      .join('\n')
    for (const technical of ['maxTurns', 'collectFields', 'qualification', 'prompt', 'salesMove']) {
      expect(rendered, `the setup screen exposes ${technical}`).not.toMatch(new RegExp(`\\b${technical}\\b`))
    }
  })

  it('asks for the business name only when the account has none', () => {
    expect(style).toContain('replyMode === \'ai\' && needsBusinessName')
    expect(style).toContain('הסוכן פותח איתו כל שיחה')
  })

  it('warns when the description asked for something the agent cannot do', () => {
    expect(style).toContain('הסוכן לא מבצע את הפעולות האלה בפועל')
  })
})
