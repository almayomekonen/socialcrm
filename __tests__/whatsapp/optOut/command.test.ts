import { describe, expect, it } from 'vitest'
import { classifyOptOutCommand, OPT_IN_COMMANDS, OPT_OUT_COMMANDS } from '@/lib/whatsapp/optOut/command'
import { toCustomerPhoneE164 } from '@/lib/whatsapp/optOut/phone'

/**
 * Phase 0 Item 3: the whole-message opt-out / re-opt-in classifier. Lists are
 * owner-approved (2026-11-06); this file pins them exactly.
 */

describe('the approved command lists', () => {
  it('opt-out: exactly the owner-approved Hebrew and English phrases', () => {
    expect([...OPT_OUT_COMMANDS].sort()).toEqual(
      [
        'עצור', 'הסר', 'הסרה', 'הסר אותי', 'הסירו אותי', 'תסירו אותי', 'תפסיק', 'תפסיקי', 'תפסיקו', 'הפסק',
        'הפסיקו', 'אל תשלחו לי', 'לא לשלוח לי', 'נא להסיר אותי',
        'stop', 'stop all', 'stop messages', 'stop texting', 'unsubscribe', 'unsubscribe me', 'remove me',
        'opt out', 'do not contact me',
      ].sort(),
    )
  })
  it('re-opt-in: START, התחל, הרשמה מחדש', () => {
    expect([...OPT_IN_COMMANDS].sort()).toEqual(['start', 'התחל', 'הרשמה מחדש'].sort())
  })
  it.each(['cancel', 'end', 'quit', 'CANCEL', 'End.', 'Quit!'])('removed as ambiguous: %s is not a command', (t) => {
    expect(classifyOptOutCommand(t)).toBeNull()
  })
})

describe('every approved phrase is recognised as a whole message', () => {
  it.each(OPT_OUT_COMMANDS.map((c) => [c]))('opt-out: %s', (c) => expect(classifyOptOutCommand(c)).toBe('opt_out'))
  it.each(OPT_IN_COMMANDS.map((c) => [c]))('opt-in: %s', (c) => expect(classifyOptOutCommand(c)).toBe('opt_in'))
})

describe('normalisation: case, punctuation, emoji, spacing, niqqud, politeness at the edges', () => {
  it.each([
    'STOP', 'Stop', 'stop.', 'STOP!!!', '  stop  ', 'stop 🛑', '🛑 STOP', 'Stop all', 'STOP\nALL', 'opt-out', 'Opt Out',
    'Do not contact me.', 'Unsubscribe me please', 'please stop', 'עצור!', 'עצור.', '  הסר  ', 'הסר אותי בבקשה',
    'בבקשה הסירו אותי', 'נא להסיר אותי.', 'תפסיקו!!', 'עֲצוֹר', 'אל תשלחו לי!', 'stop, thanks', 'תודה, הסר',
  ])('opt-out: %j', (t) => expect(classifyOptOutCommand(t)).toBe('opt_out'))

  it.each(['START', 'Start!', 'start 🙂', 'התחל', 'התחל.', 'הרשמה מחדש', 'please start'])('opt-in: %j', (t) =>
    expect(classifyOptOutCommand(t)).toBe('opt_in'),
  )
})

describe('negations, references and ordinary conversation are never commands', () => {
  it.each([
    // negated
    'אל תעצור', 'אל תפסיקו', 'לא להסיר', 'אל תסירו אותי', 'לא, אל תסירו אותי', "don't stop", 'do not stop', 'never stop',
    'please do not unsubscribe me', 'אני לא רוצה להסיר',
    // reference / quotation
    'כתבתי לו עצור', 'הוא אמר "עצור"', 'מה זה STOP?', 'the sign said stop', 'how do I unsubscribe?', 'should I write stop?',
    // ordinary conversation containing a command word
    'stop by tomorrow?', 'עצור רגע, יש לי שאלה', 'הסר את הכתם מהספה', 'הסרה של שיער בלייזר כמה עולה?', 'start date?',
    'when do you start?', 'התחלנו את העבודה', 'stopped', 'stopping', 'unstoppable', 'restart', 'הסרתי', 'תפסיקו לצלצל לי בלילה ותשלחו הודעה',
    'remove me from the meeting invite and add Dan', 'stop all the noise and call me',
    // politeness words alone, empty and non-text
    'בבקשה', 'תודה', 'please', '', '   ', '🛑', '!!!',
  ])('not a command: %j', (t) => expect(classifyOptOutCommand(t)).toBeNull())

  it('politeness is stripped only at the edges, never from the middle', () => {
    expect(classifyOptOutCommand('stop please all')).toBeNull()
    expect(classifyOptOutCommand('הסר בבקשה אותי')).toBeNull()
  })

  it('a long message is never a command, even if it ends with one', () => {
    expect(classifyOptOutCommand(`${'מה שלומך היום '.repeat(10)}עצור`)).toBeNull()
  })

  it.each([null, undefined, 42, {}, ['stop']])('non-string input: %j', (v) => expect(classifyOptOutCommand(v)).toBeNull())
})

describe('customer number canonicalisation (E.164, the number Meta receives)', () => {
  it.each([
    ['972501234567', '+972501234567'],
    ['+972 50-123-4567', '+972501234567'],
    ['0501234567', '+972501234567'],
    ['050-123-4567', '+972501234567'],
    ['14155552671', '+14155552671'],
    ['+44 7700 900123', '+447700900123'],
  ])('%s → %s', (raw, e164) => expect(toCustomerPhoneE164(raw)).toBe(e164))

  it('the Israeli local form and the international form are the same customer', () => {
    expect(toCustomerPhoneE164('0537736636')).toBe(toCustomerPhoneE164('972537736636'))
  })

  it.each(['', '123', '0001234567', '0123', 'abc', '1234567890123456', null, undefined])('not a number: %j', (raw) =>
    expect(toCustomerPhoneE164(raw as string)).toBeNull(),
  )
})
