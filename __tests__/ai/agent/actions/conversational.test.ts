/**
 * The conversational half of the execution experience.
 *
 * WHAT THE APPLICATION MUST OWN, and therefore what is testable here: the DATE,
 * and the WORDS. A model that guesses "מחר" writes a follow-up to the wrong day
 * silently, and a UI that calls a follow-up a task sends a rep to the wrong
 * screen. Both are deterministic, so both are pinned.
 *
 * Slot-filling across turns is the model's work — it has the history — so what
 * is asserted about it is the CONTRACT it is given, the same way the routing and
 * investigation policies are. The behaviour itself is measured live.
 */
import { describe, expect, it } from 'vitest'
import { AGENT_SYSTEM_PROMPT, agentDateContext, buildAgentSystemPrompt } from '@/lib/agent/prompt'
import { actionReportLabel, ACTION_REPORT_FALLBACK } from '@/components/agent/agentTypes'
import { businessDateString, startOfBusinessDayMs } from '@/lib/today/time'

describe('the date is the application\'s, not the model\'s', () => {
  const NOON_UTC = Date.parse('2026-09-06T12:00:00Z')

  it('states today, tomorrow and the day after as literal dates', () => {
    const ctx = agentDateContext(NOON_UTC)
    expect(ctx).toContain('היום: 2026-09-06')
    expect(ctx).toContain('מחר: 2026-09-07')
    expect(ctx).toContain('מחרתיים: 2026-09-08')
  })

  it('tells the model not to compute dates itself', () => {
    expect(agentDateContext(NOON_UTC)).toMatch(/אל תחשב תאריכים בעצמך/)
  })

  it('never asks the user to convert a date by hand', () => {
    expect(agentDateContext(NOON_UTC)).toMatch(/אל תבקש מהמשתמש להמיר תאריך/)
  })

  it('uses the BUSINESS day, not the server\'s', () => {
    // 22:30 UTC on the 6th is already the 7th in Jerusalem. A server-local
    // answer here would be a day behind for every evening conversation.
    const lateEvening = Date.parse('2026-09-06T22:30:00Z')
    expect(agentDateContext(lateEvening)).toContain(`היום: ${businessDateString(lateEvening)}`)
    expect(agentDateContext(lateEvening)).toContain('היום: 2026-09-07')
  })

  it('advances exactly one calendar day across a DST boundary', () => {
    // Israel ends DST in late October; a 25-hour day must still yield the next
    // date, which a flat +24h would get wrong.
    for (const day of ['2026-10-24', '2026-10-25', '2026-10-26', '2026-03-27', '2026-03-28']) {
      const ms = startOfBusinessDayMs(Date.parse(`${day}T12:00:00Z`))
      const ctx = agentDateContext(ms)
      const today = businessDateString(ms)
      const tomorrow = businessDateString(startOfBusinessDayMs(ms) + 26 * 3600 * 1000)
      expect(ctx, day).toContain(`היום: ${today}`)
      expect(ctx, day).toContain(`מחר: ${tomorrow}`)
      // One day apart, never zero and never two.
      const diff = (Date.parse(tomorrow) - Date.parse(today)) / 86_400_000
      expect(diff, day).toBe(1)
    }
  })

  it('is appended to the stable prompt rather than replacing it', () => {
    const built = buildAgentSystemPrompt(NOON_UTC)
    expect(built).toContain(AGENT_SYSTEM_PROMPT)
    expect(built).toContain('היום: 2026-09-06')
  })
})

describe('the agent fills slots instead of running a form', () => {
  it('is told to keep what the conversation already established', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/אתה מנהל שיחה, לא טופס/)
    expect(AGENT_SYSTEM_PROMPT).toMatch(/הוסף אותו למה שכבר יש ואל תתחיל מהתחלה/)
  })

  it('is forbidden from re-asking what it already knows', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/אל תשאל שוב על משהו שהמשתמש כבר אמר/)
  })

  it('asks ONE focused question about what is missing', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/שאל שאלה אחת ממוקדת על מה שחסר בלבד/)
  })

  it('does not ask for confirmation once every required field is known', () => {
    // The rep already said "תיצור לי משימה". Asking "שאצור?" is the form
    // behaviour this whole phase exists to remove.
    expect(AGENT_SYSTEM_PROMPT).toMatch(/אל תבקש אישור נוסף ואל תשאל "שאצור\?"/)
  })

  it('never invents a missing value', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/אל תמציא כותרת, תאריך, הערה או ליד/)
    expect(AGENT_SYSTEM_PROMPT).toMatch(/חסר זה חסר — תשאל/)
  })
})

describe('unsupported precision is explained, not refused', () => {
  it('says a task and a follow-up store a date and no time', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/במשימה ובמעקב המערכת שומרת תאריך בלבד, בלי שעה/)
  })

  it('says a MEETING does store the time — the one action where it is real', () => {
    // A meeting at ten and a meeting at four are different meetings, and the
    // row holds real instants. Telling a rep the time was dropped would be a lie.
    expect(AGENT_SYSTEM_PROMPT).toMatch(/בפגישה השעה כן נשמרת/)
    expect(AGENT_SYSTEM_PROMPT).toMatch(/אל תאמר על פגישה שהשעה לא נשמרת/)
  })

  it('asks only for the duration when only the duration is missing', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/אין לו ברירת מחדל/)
    expect(AGENT_SYSTEM_PROMPT).toMatch(/שאל רק על המשך/)
  })

  it('continues executing rather than stopping on a time the rep gave', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/המשך בביצוע/)
    expect(AGENT_SYSTEM_PROMPT).toMatch(/אל תעצור בגלל זה ואל תבקש ממנו לתקן/)
  })
})

describe('conversational references', () => {
  it('are resolved only when unambiguous', () => {
    for (const phrase of ['אותו ליד', 'אותה משימה', 'אותו תאריך', 'כמו קודם']) {
      expect(AGENT_SYSTEM_PROMPT, phrase).toContain(phrase)
    }
    expect(AGENT_SYSTEM_PROMPT).toMatch(/רק כשהן חד-משמעיות/)
    expect(AGENT_SYSTEM_PROMPT).toMatch(/אם יש יותר מאפשרות אחת, שאל/)
  })

  it('permit inheriting a note the USER established, never one the agent invents', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/מותר לרשת note מהקשר שהמשתמש עצמו יצר/)
    expect(AGENT_SYSTEM_PROMPT).toMatch(/אל תמציא הערה משלך/)
    // And the inherited value must be visible in the result.
    expect(AGENT_SYSTEM_PROMPT).toMatch(/אמור בתשובה מה ההערה שנקבעה/)
  })
})

describe('a follow-up is never called a task', () => {
  it('the prompt says so', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/לעולם אל תקרא לאחד מהם בשם של אחר/)
  })

  it('the UI says so, in every state that names the object', () => {
    for (const report of ['VERIFIED_SUCCESS', 'EXECUTED_UNVERIFIED', 'DUPLICATE_NOOP']) {
      const task = actionReportLabel(report, 'create_task').title
      const followUp = actionReportLabel(report, 'create_follow_up').title
      const meeting = actionReportLabel(report, 'create_meeting').title
      expect(task, report).toContain('המשימה')
      expect(followUp, report).toContain('המעקב')
      expect(meeting, report).toContain('הפגישה')
      // The exact defect this guards: one object rendered as another.
      expect(followUp, report).not.toContain('משימה')
      expect(meeting, report).not.toContain('משימה')
      expect(meeting, report).not.toContain('מעקב')
    }
  })

  it('shares the wording only where no object is named', () => {
    for (const report of ['AWAITING_APPROVAL', 'REJECTED', 'FAILED', 'NOT_EXECUTED', 'UNKNOWN_RECONCILE']) {
      expect(actionReportLabel(report, 'create_task')).toEqual(actionReportLabel(report, 'create_follow_up'))
      expect(actionReportLabel(report, 'create_task')).toEqual(actionReportLabel(report, 'create_meeting'))
    }
  })

  it('falls back rather than inventing a label for an unknown state', () => {
    expect(actionReportLabel('WAT', 'create_task')).toEqual(ACTION_REPORT_FALLBACK)
    expect(actionReportLabel(null)).toEqual(ACTION_REPORT_FALLBACK)
    // An unknown ACTION still gets the neutral wording for a known state.
    expect(actionReportLabel('REJECTED', 'create_invoice').title).toBe('ביטלת את הפעולה')
  })
})
