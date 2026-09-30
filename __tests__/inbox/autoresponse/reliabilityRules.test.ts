import { describe, expect, it } from 'vitest'
import {
  allOpeners,
  decideDeterministicTurn,
  isOpenerOnly,
  mediaOnlyKind,
  readableInboundText,
} from '@/lib/inbox/autoresponse/reliability/silence'
import {
  humanTookOverSinceEpoch,
  legacyHumanTookOver,
  ownershipEpochSequence,
} from '@/lib/inbox/autoresponse/reliability/ownership'
import { automaticReplyNeedsAi } from '@/lib/inbox/autoresponse/reliability/entitlement'
import { canUseAgentReliability } from '@/lib/flags/agentReliabilityFlags'
import { mergeQualification } from '@/lib/inbox/autoresponse/qualification'

describe('openers', () => {
  it.each(['היי', 'שלום', 'הייייי', 'hi', '👋', '?', '!!'])('%s is an opener', (t) => expect(isOpenerOnly(t)).toBe(true))
  it.each(['היי, כמה עולה?', 'אני צריכה תור', 'שלום, רציתי לשאול על מחירים', ''])('%s is not', (t) =>
    expect(isOpenerOnly(t)).toBe(false),
  )
  it('needs at least one text, and every text must be an opener', () => {
    expect(allOpeners([])).toBe(false)
    expect(allOpeners(['היי', 'שלום'])).toBe(true)
    expect(allOpeners(['היי', 'יש לכם תור מחר?'])).toBe(false)
  })
})

describe('media', () => {
  const img = (payload: object = {}) => ({ direction: 'inbound', type: 'image', text: '', payload })
  it('reads a caption as text, and only for captioned types', () => {
    expect(readableInboundText(img({ caption: ' שבור ' }))).toBe('שבור')
    expect(readableInboundText({ direction: 'inbound', type: 'sticker', text: '', payload: { caption: 'x' } })).toBe('')
    expect(readableInboundText({ direction: 'inbound', type: 'text', text: 'שלום' })).toBe('שלום')
  })
  it('classifies what deserves an acknowledgement', () => {
    expect(mediaOnlyKind([img()])).toBe('visual')
    expect(mediaOnlyKind([{ direction: 'inbound', type: 'audio', text: '' }, img()])).toBe('voice')
    expect(mediaOnlyKind([img({ caption: 'מה זה?' })])).toBeNull()
    expect(mediaOnlyKind([{ direction: 'inbound', type: 'sticker', text: '' }])).toBeNull()
    expect(mediaOnlyKind([{ direction: 'inbound', type: 'reaction', text: '' }])).toBeNull()
    expect(mediaOnlyKind([])).toBeNull()
  })
  it('never acknowledges twice in a row', () => {
    const lastOutbound = { metadata: { source: 'auto_response', kind: 'media_ack' } }
    expect(decideDeterministicTurn({ pending: [img()], firstContact: false, greetingLine: null, lang: 'he', lastOutbound })).toBeNull()
  })
  it('does not greet mid-conversation', () => {
    const d = decideDeterministicTurn({
      pending: [{ direction: 'inbound', type: 'text', text: 'היי' }],
      firstContact: false,
      greetingLine: null,
      lang: 'he',
      lastOutbound: null,
    })
    expect(d).toBeNull()
  })
})

describe('ownership', () => {
  const out = (sequence: number, metadata: object | null, sentByUserId: number | null, status: string | null = 'sent') => ({
    direction: 'outbound',
    sequence,
    metadata,
    sentByUserId,
    status,
  })
  it('counts only people, after the epoch', () => {
    const rows = [
      out(2, null, 7), // rep, before the return
      out(3, { source: 'auto_response' }, 7),
      out(4, null, null), // automation template
      out(5, { source: 'questionnaire' }, 7),
      out(6, { source: 'whatsapp_history' }, 7),
      out(7, null, 7, 'failed'),
    ]
    expect(humanTookOverSinceEpoch(rows, 2)).toBe(false)
    expect(humanTookOverSinceEpoch(rows, 0)).toBe(true)
    expect(humanTookOverSinceEpoch([...rows, out(8, { source: 'smb_message_echo' }, null)], 2)).toBe(true)
  })
  it('a human reply whose position is unknown still wins', () => {
    expect(humanTookOverSinceEpoch([{ direction: 'outbound', metadata: null, sentByUserId: 7 }], 5)).toBe(true)
    expect(humanTookOverSinceEpoch([{ direction: 'outbound', metadata: null, sentByUserId: 7, sequence: null }], 0)).toBe(true)
  })
  it('the legacy rule is unchanged for agencies outside the rollout', () => {
    expect(legacyHumanTookOver([out(4, null, null)])).toBe(true)
    expect(legacyHumanTookOver([out(3, { source: 'auto_response' }, 7)])).toBe(false)
  })
  it('the epoch survives every merge and is never model-settable', () => {
    const current = { name: 'דנה', ownership: { sinceSequence: 9 } }
    expect(mergeQualification(current, { need: 'תור' }).ownership).toEqual({ sinceSequence: 9 })
    expect(mergeQualification({}, { ownership: { sinceSequence: 99 } } as never).ownership).toBeUndefined()
    expect(ownershipEpochSequence({ ownership: { sinceSequence: 9 } })).toBe(9)
    expect(ownershipEpochSequence({})).toBe(0)
  })
})

describe('entitlement scope', () => {
  it('only an AI reply needs the AI entitlement', () => {
    expect(automaticReplyNeedsAi({ responder: 'questionnaire', mode: 'qualify', replyMode: 'ai' })).toBe(false)
    expect(automaticReplyNeedsAi({ responder: 'agent', mode: 'qualify', replyMode: 'ai' })).toBe(true)
    expect(automaticReplyNeedsAi({ responder: 'agent', mode: 'acknowledge', replyMode: 'ai' })).toBe(true)
    expect(automaticReplyNeedsAi({ responder: 'agent', mode: 'acknowledge', replyMode: 'fixed' })).toBe(false)
    expect(automaticReplyNeedsAi(null)).toBe(false)
  })
})

describe('the flag', () => {
  it('is absent by default and names agencies explicitly', () => {
    const saved = process.env.AGENT_RELIABILITY_AGENCY_IDS
    delete process.env.AGENT_RELIABILITY_AGENCY_IDS
    expect(canUseAgentReliability(103)).toBe(false)
    process.env.AGENT_RELIABILITY_AGENCY_IDS = '103'
    expect(canUseAgentReliability(103)).toBe(true)
    expect(canUseAgentReliability(149)).toBe(false)
    process.env.AGENT_RELIABILITY_AGENCY_IDS = 'all'
    expect(canUseAgentReliability(149)).toBe(true)
    if (saved === undefined) delete process.env.AGENT_RELIABILITY_AGENCY_IDS
    else process.env.AGENT_RELIABILITY_AGENCY_IDS = saved
  })
})
