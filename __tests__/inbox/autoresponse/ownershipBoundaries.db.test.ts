import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { insertOutboundMessage } from '@/db/inboxMessages'
import { ECHO_SOURCE } from '@/lib/inbox/ingestWhatsappEcho'

/**
 * THE TWO THINGS THAT MUST NEVER READ AS A HUMAN TAKING OVER.
 *
 * `qualifyWorker` derives takeover from the transcript: any outbound whose
 * `metadata.source` is not `auto_response` means a person spoke. That rule is
 * what makes a rep's reply stop the agent — and it is one metadata slip away
 * from the agent silencing itself with its own message.
 *
 * Two ways that could happen, both exercised here against a real database:
 *
 *   1. The agent's own outbound, if the source marker were ever missing.
 *   2. A WhatsApp Coexistence ECHO of that same message. Meta echoes what the
 *      business sends, our own sends included, and the echo path stamps
 *      `smb_message_echo` — which is deliberately NOT `auto_response`, because a
 *      genuine echo IS a human replying from their phone.
 *
 * The protection for (2) is the wamid: an echo of our own message carries the
 * same `externalId`, so it deduplicates into the row we already wrote instead of
 * arriving as a second, human-looking outbound. This proves that holds in both
 * orderings, including the one where the echo wins the race.
 */

const PHONE_ID = '__echo_owner_pn'
const CUSTOMER = '972500000088'
const WAMID = 'wamid.AGENT_TURN_1'

let agencyId: number
let userId: number
let leadId: number
let conversationId: number

/** The worker's own rule, lifted verbatim. */
const metaSource = (metadata: unknown): string => {
  try {
    const m = typeof metadata === 'string' ? JSON.parse(metadata) : metadata
    return (m as { source?: string } | null)?.source ?? ''
  } catch {
    return ''
  }
}

async function readsAsHumanTakeover(): Promise<boolean> {
  const rows = await db('inbox_messages').where({ conversationId }).select('direction', 'metadata')
  return rows.some((m) => m.direction === 'outbound' && metaSource(m.metadata) !== 'auto_response')
}

async function outboundRows() {
  return db('inbox_messages').where({ conversationId, direction: 'outbound' }).select('id', 'externalId', 'metadata')
}

/** What ireSend does after persisting: merge the agent marker onto the row. */
const stampAgentSource = (messageId: number) =>
  db('inbox_messages')
    .where({ id: messageId })
    .update({
      metadata: db.raw(`metadata || ?::jsonb`, [JSON.stringify({ source: 'auto_response', reason: 'qualify_turn', phase: 2 })]),
    })

const insertOutbound = (externalId: string, text: string) =>
  db.transaction((trx) =>
    insertOutboundMessage(trx, {
      conversationId,
      agencyId,
      leadId,
      channel: 'whatsapp',
      externalId,
      fromId: PHONE_ID,
      toId: CUSTOMER,
      text,
      sentByUserId: null,
      channelTimestamp: new Date(),
    }),
  )

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: '__test_echo_owner__', autoResponseEnabled: true }).returning('id')
  agencyId = Number(a.id)
  const [u] = await db('users').insert({ firstName: 'F', role: 'AGNT', agencyId }).returning('id')
  userId = Number(u.id)
  const [c] = await db('clients')
    .insert({ firstName: 'לקוח', lastName: 'בדיקה', phone: CUSTOMER, agencyId, userId, createdById: userId, status: 'new' })
    .returning('id')
  leadId = Number(c.id)
  const [conv] = await db('inbox_conversations')
    .insert({
      agencyId,
      leadId,
      channel: 'whatsapp',
      businessPhoneNumberId: PHONE_ID,
      customerWaId: CUSTOMER,
      customerName: 'לקוח בדיקה',
    })
    .returning('id')
  conversationId = Number(conv.id)
})

beforeEach(async () => {
  await db('inbox_messages').where({ conversationId }).del()
})

afterAll(async () => {
  await db('inbox_messages').where({ conversationId }).del()
  await db('inbox_conversations').where({ id: conversationId }).del()
  await db('clients').where({ id: leadId }).del()
  await db('users').where({ id: userId }).del()
  await db('agencies').where({ id: agencyId }).del()
})

describe('the agent cannot silence itself with its own message', () => {
  it('its own outbound, correctly stamped, is not a takeover', async () => {
    const { id } = await insertOutbound(WAMID, 'היי, ברוך הבא 👋 מה התקלה?')
    await stampAgentSource(id)
    expect(await readsAsHumanTakeover()).toBe(false)
  })

  it('an echo of that same message deduplicates instead of arriving as a human reply', async () => {
    // Normal ordering: we persist and stamp, then Meta echoes what we sent.
    const first = await insertOutbound(WAMID, 'היי, ברוך הבא 👋 מה התקלה?')
    await stampAgentSource(first.id)

    const echo = await insertOutbound(WAMID, 'היי, ברוך הבא 👋 מה התקלה?')
    expect(echo.inserted, 'the echo created a SECOND outbound row').toBe(false)
    expect(echo.id).toBe(first.id)
    expect(await outboundRows()).toHaveLength(1)
    expect(await readsAsHumanTakeover()).toBe(false)
  })

  it('AND when the echo wins the race, arriving before our own persist', async () => {
    // The dangerous ordering. The echo lands first and stamps smb_message_echo;
    // our persist then dedupes into that row and ireSend's metadata merge is
    // what puts `auto_response` back on top. If that merge were ever made
    // conditional on `inserted`, this is the test that would fail.
    const echoFirst = await insertOutbound(WAMID, 'היי, ברוך הבא 👋 מה התקלה?')
    await db('inbox_messages')
      .where({ id: echoFirst.id })
      .update({ metadata: db.raw(`metadata || ?::jsonb`, [JSON.stringify({ source: ECHO_SOURCE })]) })
    expect(await readsAsHumanTakeover(), 'precondition: a bare echo DOES read as human').toBe(true)

    const ours = await insertOutbound(WAMID, 'היי, ברוך הבא 👋 מה התקלה?')
    expect(ours.inserted).toBe(false)
    await stampAgentSource(ours.id)

    expect(await outboundRows()).toHaveLength(1)
    expect(await readsAsHumanTakeover(), 'the agent read its own message as a human takeover').toBe(false)
  })
})

describe('a genuine human reply still stops the agent', () => {
  it('a rep replying through the product is a takeover', async () => {
    const { id } = await insertOutbound('wamid.HUMAN_1', 'היי, אני אלמיו מהמוסך')
    await db('inbox_messages').where({ id }).update({ sentByUserId: userId })
    expect(await readsAsHumanTakeover()).toBe(true)
  })

  it('an echo of a DIFFERENT message — the business answering from their phone — is a takeover', async () => {
    const agent = await insertOutbound(WAMID, 'היי, ברוך הבא 👋')
    await stampAgentSource(agent.id)

    const fromPhone = await insertOutbound('wamid.FROM_PHONE', 'היי, מדבר אלון מהמוסך')
    expect(fromPhone.inserted, 'a different wamid must create its own row').toBe(true)
    await db('inbox_messages')
      .where({ id: fromPhone.id })
      .update({ metadata: db.raw(`metadata || ?::jsonb`, [JSON.stringify({ source: ECHO_SOURCE })]) })

    expect(await outboundRows()).toHaveLength(2)
    expect(await readsAsHumanTakeover(), 'a person typed this on their phone').toBe(true)
  })

  it('ECHO_SOURCE is deliberately not auto_response', () => {
    // Stated as a test because the two markers being different is load-bearing
    // in both directions: equal, and a rep's phone reply would be invisible;
    // both meaningless, and the agent would silence itself.
    expect(ECHO_SOURCE).not.toBe('auto_response')
  })
})
