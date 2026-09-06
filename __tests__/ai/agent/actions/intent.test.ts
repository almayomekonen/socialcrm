/**
 * Who asked — the input the whole authorization decision now turns on.
 *
 * THE RULE IT ENFORCES is that intent comes from the PERSON'S words and from
 * nowhere else. The model has no field for it, the proposal has no field for it,
 * and a request body cannot carry one. So the tests below are mostly about
 * failing closed: every shape this cannot read as a clear instruction must come
 * out AGENT_PROPOSAL, because the cost of a false negative is one extra tap and
 * the cost of a false positive is a mutation nobody asked for.
 */
import { describe, expect, it } from 'vitest'
import { deriveActionIntent } from '@/lib/agent/actions/intent'
import { AGENT_SYSTEM_PROMPT } from '@/lib/agent/prompt'
import { actionProposalSchema } from '@/lib/agent/actions'
import { agentAnswerSchema } from '@/lib/agent/answerSchema'

const intentOf = (userMessage: string, priorAssistantMessage?: string | null) =>
  deriveActionIntent({ userMessage, priorAssistantMessage }).intent

describe('an explicit instruction', () => {
  it('recognises the imperative forms a rep actually uses', () => {
    for (const message of [
      'תיצור לי משימה להתקשר ליוסי ב-8/9',
      'צור משימה להתקשר לדנה',
      'תפתח משימה למעקב אחרי יוסי',
      'תזכיר לי להתקשר למיכל מחר',
      'קבע משימה לשבוע הבא',
      'עשה לי משימה להתקשר ליוסי',
      'create a task to call Yossi tomorrow',
    ]) {
      expect(intentOf(message), message).toBe('EXPLICIT_COMMAND')
    }
  })

  it('is not fooled by a prefix letter glued to the verb', () => {
    // Hebrew attaches ו/ה/ש/ל/ב/כ/מ directly to words; a naive word boundary
    // fails on every one of these.
    expect(intentOf('ותיצור גם משימה ליוסי')).toBe('EXPLICIT_COMMAND')
  })
})

describe('a suggestion is not an instruction', () => {
  it('demotes anything hedged, even when it carries a command verb', () => {
    for (const message of [
      'אולי תיצור משימה ליוסי',
      'כדאי ליצור משימה למעקב',
      'אני ממליץ ליצור משימה',
      'שווה לפתוח משימה ליוסי?',
      'מה דעתך ליצור משימה',
      'maybe create a task for Yossi',
    ]) {
      expect(intentOf(message), message).toBe('AGENT_PROPOSAL')
    }
  })

  it('treats a question as a question', () => {
    for (const message of ['האם כדאי ליצור משימה?', 'מה הבעיה הכי גדולה שלי?', 'should I create a task?']) {
      expect(intentOf(message), message).toBe('AGENT_PROPOSAL')
    }
  })

  it('reads an ordinary business question as no instruction at all', () => {
    expect(intentOf('מה קורה בעסק שלי עכשיו?')).toBe('AGENT_PROPOSAL')
    expect(intentOf('מי צריך טיפול היום')).toBe('AGENT_PROPOSAL')
  })

  it('fails closed on an empty or unreadable message', () => {
    for (const message of ['', '   ', '...', 'אוקיי אז מה']) {
      expect(intentOf(message), JSON.stringify(message)).toBe('AGENT_PROPOSAL')
    }
  })
})

describe('confirming what the agent just suggested', () => {
  const suggestion = 'מצאתי 25 לידים שהתקררו. כדאי ליצור להם משימת מעקב.'

  it('turns an affirmation into an instruction', () => {
    for (const message of ['כן, תעשה', 'כן', 'בסדר', 'אישור', 'קדימה', 'yes', 'go ahead']) {
      expect(intentOf(message, suggestion), message).toBe('EXPLICIT_COMMAND')
    }
  })

  it('refuses a bare affirmation with nothing to affirm', () => {
    // Opening a conversation with "כן" agrees with nothing, and must not
    // authorise whatever the model then decides to propose.
    expect(intentOf('כן')).toBe('AGENT_PROPOSAL')
    expect(deriveActionIntent({ userMessage: 'כן' }).reason).toBe('affirmation-without-context')
  })

  it('does not treat a hedged reply to a suggestion as agreement', () => {
    expect(intentOf('אולי, אני עוד חושב', suggestion)).toBe('AGENT_PROPOSAL')
  })
})

describe('a command survives the turns that complete it', () => {
  const COMMAND = 'תיצור לי משימה עבור דניאל כהן'

  it('a bare value completing a prior instruction is still that instruction', () => {
    /**
     * The defect live conversation exposed. "תיצור לי משימה עבור דניאל כהן" →
     * "למחר בשעה 10:00" → "לחזור לדניאל" put an approval card in front of a rep
     * who had already given the order and was answering the agent's own
     * question. The last turn carries no verb because the verb was three turns
     * ago.
     */
    expect(
      deriveActionIntent({
        userMessage: 'לחזור לדניאל',
        priorUserMessages: ['למחר בשעה 10:00 בבוקר', COMMAND],
      }).intent,
    ).toBe('EXPLICIT_COMMAND')
    expect(deriveActionIntent({ userMessage: 'לחזור לדניאל', priorUserMessages: [COMMAND] }).reason)
      .toBe('continues-prior-command')
  })

  it('does not reach back further than the carry window', () => {
    const stale = ['ד', 'ג', 'ב', COMMAND] // the command is 4 turns back
    expect(deriveActionIntent({ userMessage: 'לחזור לדניאל', priorUserMessages: stale }).intent)
      .toBe('AGENT_PROPOSAL')
  })

  it('a hedge in the CURRENT turn still demotes, whatever came before', () => {
    expect(
      deriveActionIntent({ userMessage: 'אולי כדאי גם משימה', priorUserMessages: [COMMAND] }).intent,
    ).toBe('AGENT_PROPOSAL')
  })

  it('a question in the current turn still demotes', () => {
    expect(
      deriveActionIntent({ userMessage: 'מה הבעיה הכי גדולה שלי?', priorUserMessages: [COMMAND] }).intent,
    ).toBe('AGENT_PROPOSAL')
  })

  it('a hedged prior turn is not a standing command', () => {
    expect(
      deriveActionIntent({ userMessage: 'לחזור לדניאל', priorUserMessages: ['אולי כדאי ליצור משימה'] }).intent,
    ).toBe('AGENT_PROPOSAL')
  })

  it('inherits only from the USER\'s turns, never the assistant\'s', () => {
    // An assistant that wrote "תיצור משימה" in its own prose authorises nothing.
    expect(
      deriveActionIntent({
        userMessage: 'לחזור לדניאל',
        priorAssistantMessage: 'אני ממליץ: תיצור משימה לדניאל',
        priorUserMessages: ['מה קורה בעסק?'],
      }).intent,
    ).toBe('AGENT_PROPOSAL')
  })

  it('with no history at all, a bare value is not a command', () => {
    expect(deriveActionIntent({ userMessage: 'לחזור לדניאל' }).intent).toBe('AGENT_PROPOSAL')
  })
})

describe('the model cannot declare its own authorization', () => {
  it('the answer schema has no intent, risk or approval field', () => {
    const shape = JSON.stringify(agentAnswerSchema.shape.proposedAction)
    for (const forbidden of ['intent', 'EXPLICIT_COMMAND', 'approvalRequired', 'risk', 'agencyId', 'userId', 'role']) {
      expect(shape, forbidden).not.toContain(forbidden)
    }
  })

  it('a payload claiming explicit authorization loses it in parsing', () => {
    const parsed = actionProposalSchema.safeParse({
      actionType: 'create_task',
      args: { clientId: 1, title: 't', dueDate: '2026-09-08' },
      evidenceRefs: [],
      intent: 'EXPLICIT_COMMAND',
      approvalRequired: false,
      userAuthorized: true,
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(Object.keys(parsed.data)).not.toContain('intent')
      expect(Object.keys(parsed.data)).not.toContain('approvalRequired')
      expect(Object.keys(parsed.data)).not.toContain('userAuthorized')
    }
  })
})

describe('the model never claims the task exists', () => {
  it('the prompt forbids it, even for an explicit command', () => {
    // The answer is written BEFORE the action runs, so any claim of success in
    // it would be a guess. The application says "created", after verifying.
    expect(AGENT_SYSTEM_PROMPT).toMatch(/אסור לכתוב שהמשימה נוצרה או שהמעקב נקבע/)
    expect(AGENT_SYSTEM_PROMPT).toMatch(/גם אם המשתמש ביקש זאת במפורש/)
    expect(AGENT_SYSTEM_PROMPT).toMatch(/המערכת מריצה את הפעולה אחרי התשובה שלך/)
  })
})
