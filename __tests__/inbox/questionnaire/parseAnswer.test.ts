import { describe, expect, it } from 'vitest'
import {
  classifyInboundKind,
  detectCommand,
  joinTextInputs,
  parseChoice,
  parseFreeText,
} from '@/lib/inbox/autoresponse/questionnaire/parseAnswer'
import type { QuestionnaireChoiceStep } from '@/lib/inbox/autoresponse/questionnaire/definition'

/**
 * Reading a customer's reply without a model.
 *
 * The bar is not "understands Hebrew". It is: recognise the answers a numbered
 * menu invites, and refuse everything else clearly enough that the re-prompt
 * is honest rather than a guess dressed up as understanding.
 */

const step: QuestionnaireChoiceStep = {
  id: 'services',
  type: 'choice',
  label: 'שירותים',
  prompt: 'אילו שירותים מעניינים אתכם?',
  options: [
    { id: 'stills', label: 'צילום סטילס' },
    { id: 'video', label: 'וידאו' },
    { id: 'drone', label: 'צילום רחפן' },
  ],
}
const multiStep: QuestionnaireChoiceStep = { ...step, multi: true }

const pick = (text: string, s = step) => {
  const r = parseChoice(text, s)
  return r.ok ? r.optionIds : null
}

describe('numbered answers', () => {
  it.each([
    ['2', ['video']],
    [' 2 ', ['video']],
    ['2.', ['video']],
    ['2)', ['video']],
    ['١', ['stills']], // Arabic-Indic digit, which some keyboards produce
    ['2️⃣', ['video']], // keycap emoji
  ])('reads %j as %j', (input, expected) => {
    expect(pick(input as string)).toEqual(expected)
  })

  it('reads the option label typed out, in any case', () => {
    expect(pick('וידאו')).toEqual(['video'])
    expect(pick('  צילום רחפן ')).toEqual(['drone'])
  })

  it('refuses a number outside the menu rather than clamping it', () => {
    expect(pick('0')).toBeNull()
    expect(pick('4')).toBeNull()
  })

  it.each(['אולי וידאו', 'שתיים', '2 ואולי 3 נדבר', '', '???'])('refuses %j', (input) => {
    expect(pick(input)).toBeNull()
  })

  it('refuses several picks when only one was offered, with its own reason', () => {
    const r = parseChoice('1,2', step)
    expect(r.ok).toBe(false)
    expect(r.ok === false ? r.reason : null).toBe('too_many')
  })
})

describe('multi-select', () => {
  it.each([
    ['1,3', ['stills', 'drone']],
    ['1 3', ['stills', 'drone']],
    ['1, 3', ['stills', 'drone']],
    ['3,1', ['drone', 'stills']],
  ])('reads %j as %j', (input, expected) => {
    expect(pick(input as string, multiStep)).toEqual(expected)
  })

  it('collapses a repeated pick instead of recording it twice', () => {
    expect(pick('1,1', multiStep)).toEqual(['stills'])
  })

  it('refuses the whole message when any token is unreadable', () => {
    // "1 ואולי 3" is someone thinking aloud. Taking the 1 and dropping the rest
    // would record an answer they did not give.
    expect(pick('1 ואולי 3', multiStep)).toBeNull()
  })
})

describe('free text', () => {
  it('keeps what the customer wrote', () => {
    const r = parseFreeText('  14 ביוני 2027  ')
    expect(r.ok && r.value).toBe('14 ביוני 2027')
  })

  it('refuses an empty message', () => {
    expect(parseFreeText('   ').ok).toBe(false)
  })

  it('caps a very long answer rather than letting one message flood the summary', () => {
    const r = parseFreeText('א'.repeat(500))
    expect(r.ok && r.value.length).toBe(300)
  })

  it('joins messages split across bubbles, in arrival order', () => {
    // Taking only the newest would lose the first half of a split answer.
    expect(joinTextInputs(['בתל אביב', 'או בחיפה'])).toBe('בתל אביב או בחיפה')
  })
})

describe('commands', () => {
  it.each(['תפסיקו', 'הסירו אותי', 'תסירו אותי מהרשימה', 'STOP', 'unsubscribe'])(
    'treats %j as an opt out',
    (text) => {
      expect(detectCommand(text)).toBe('opt_out')
    },
  )

  it.each(['אפשר לדבר עם נציג', 'תעבירו אותי לנציג', 'I want to talk to someone'])(
    'treats %j as asking for a person',
    (text) => {
      expect(detectCommand(text)).toBe('human')
    },
  )

  it('does not treat an answer about a meeting as asking for a person', () => {
    // detectHumanRequest would: its meeting patterns are right for a sales
    // agent and wrong for an answer to "what kind of event is it?".
    expect(detectCommand('פגישה עסקית')).toBeNull()
    expect(detectCommand('אנחנו רוצים לקבוע צילומים')).toBeNull()
  })

  it.each(['התחלה מחדש', 'מההתחלה', 'restart'])('treats %j as a restart', (text) => {
    expect(detectCommand(text)).toBe('restart')
  })

  it('leaves an ordinary answer alone', () => {
    expect(detectCommand('חתונה')).toBeNull()
    expect(detectCommand('300')).toBeNull()
    expect(detectCommand('')).toBeNull()
  })

  it('puts the stop first when a message asks for both', () => {
    expect(detectCommand('תפסיקו ותעבירו אותי לנציג')).toBe('opt_out')
  })
})

describe('what kind of message arrived', () => {
  it.each([
    ['text', 'שלום', 'text'],
    ['audio', '', 'voice'],
    ['image', '', 'media'],
    ['document', '', 'media'],
    ['sticker', '', 'media'],
    ['location', '', 'media'],
    ['interactive', '', 'media'],
    ['reaction', '', 'ignorable'],
    ['system', '', 'ignorable'],
    ['unknown', '', 'ignorable'],
  ])('classifies %s as %s', (type, text, expected) => {
    expect(classifyInboundKind(type, text)).toBe(expected)
  })

  it('reads a typed caption as text even on a media type', () => {
    expect(classifyInboundKind('image', 'זה האולם')).toBe('text')
  })
})
