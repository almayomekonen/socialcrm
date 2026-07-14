/**
 * Seed demo WhatsApp inbox conversations for a target agency user.
 *
 * Local DB (uses .env.local):
 *   npx tsx scripts/seed-whatsapp-conversations.ts
 *
 * Production DB (uses Vercel production DATABASE_URL):
 *   vercel env run --environment production -- npx tsx scripts/seed-whatsapp-conversations.ts
 */
import { db } from '../config/db'
import { findOrCreateConversation, bumpConversationOnInbound, bumpConversationOnOutbound } from '../db/inboxConversations'
import { ensureParticipant } from '../db/inboxParticipants'
import { insertInboundMessage, insertOutboundMessage } from '../db/inboxMessages'

const EMAIL = 'alamayo274@gmail.com'
const SEED_TAG = 'seed:whatsapp:demo'

type SeedMessage = { direction: 'inbound' | 'outbound'; text: string; minutesAgo: number }

type SeedConversation = {
  firstName: string
  lastName: string
  phone: string
  customerWaId: string
  customerName: string
  messages: SeedMessage[]
}

const CONVERSATIONS: SeedConversation[] = [
  {
    firstName: 'יוסי',
    lastName: 'כהן',
    phone: '972501234001',
    customerWaId: '972501234001',
    customerName: 'יוסי כהן',
    messages: [
      { direction: 'inbound', text: 'היי, אני מחפש CRM לנהל את הלידים והלקוחות שלי!!!', minutesAgo: 180 },
      { direction: 'outbound', text: 'היי יוסי, תודה שפנית! איזה סוג עסק אתה מנהל?', minutesAgo: 175 },
      { direction: 'inbound', text: 'יש לי עסק לייעוץ עסקי. בערך 50 לידים בחודש, בעיקר מפייסבוק ואינסטגרם', minutesAgo: 160 },
      { direction: 'outbound', text: 'מעולה. אציג לך דמו קצר השבוע — מה נוח לך, בוקר או אחר הצהריים?', minutesAgo: 155 },
      { direction: 'inbound', text: 'אחר הצהריים ביום שלישי מתאים לי', minutesAgo: 140 },
    ],
  },
  {
    firstName: 'דנה',
    lastName: 'לוי',
    phone: '972501234002',
    customerWaId: '972501234002',
    customerName: 'דנה לוי',
    messages: [
      { direction: 'inbound', text: 'שלום, שמעתי עליכם מחברה. כמה עולה המערכת?', minutesAgo: 90 },
      { direction: 'outbound', text: 'היי דנה! יש לנו תוכנית חינמית להתחלה, ותוכניות בתשלום לפי כמות הלידים. רוצה שאשלח פירוט?', minutesAgo: 85 },
      { direction: 'inbound', text: 'כן בבקשה, וגם לדעת אם יש חיבור לוואטסאפ', minutesAgo: 70 },
    ],
  },
  {
    firstName: 'אור',
    lastName: 'מזרחי',
    phone: '972501234003',
    customerWaId: '972501234003',
    customerName: 'אור מזרחי',
    messages: [
      { direction: 'inbound', text: 'היי, אפשר לקבוע שיחה? אני צריך CRM דחוף לצוות מכירות', minutesAgo: 45 },
      { direction: 'outbound', text: 'בטח אור! מחר ב-10:00 מתאים?', minutesAgo: 40 },
      { direction: 'inbound', text: 'מושלם, תודה', minutesAgo: 35 },
    ],
  },
  {
    firstName: 'נועה',
    lastName: 'פרץ',
    phone: '972501234004',
    customerWaId: '972501234004',
    customerName: 'נועה פרץ',
    messages: [
      { direction: 'inbound', text: 'היי, יש לכם אפשרות לייבא לידים מאקסל?', minutesAgo: 25 },
      { direction: 'outbound', text: 'כן! העלאת קובץ Excel זמינה ישירות מהמערכת. רוצה שאסביר איך?', minutesAgo: 20 },
      { direction: 'inbound', text: 'כן, וגם איך מקצים לידים לנציגים', minutesAgo: 15 },
      { direction: 'outbound', text: 'בשמחה. אשלח לך סרטון קצר + נקבע שיחה אם תרצי', minutesAgo: 10 },
    ],
  },
]

function atMinutesAgo(minutesAgo: number): Date {
  return new Date(Date.now() - minutesAgo * 60_000)
}

function fakeWamid(seed: string, idx: number): string {
  return `wamid.${SEED_TAG}.${seed}.${idx}`
}

async function run() {
  const user = await db('users').where({ email: EMAIL }).first()
  if (!user) {
    console.error(`User not found: ${EMAIL}`)
    process.exit(1)
  }

  const agencyId = Number(user.agencyId)
  const userId = Number(user.id)
  const dbHost = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : 'unknown'
  console.log(`Target: ${EMAIL} userId=${userId} agencyId=${agencyId} db=${dbHost}`)

  const wa = await db('whatsapp_connections').where({ agency_id: agencyId }).first()
  const businessPhoneNumberId =
    (wa?.phone_number_id as string | undefined) ?? `seed-business-phone-${agencyId}`
  if (!wa) {
    console.warn(`No whatsapp_connections row — using placeholder businessPhoneNumberId=${businessPhoneNumberId}`)
  } else {
    console.log(`Using businessPhoneNumberId=${businessPhoneNumberId}`)
  }

  let leadsCreated = 0
  let conversationsCreated = 0
  let messagesInserted = 0

  for (const conv of CONVERSATIONS) {
    const leadSource = `${SEED_TAG}:${conv.customerWaId}`

    let lead =
      (await db('clients').where({ agencyId, leadSource }).first()) ??
      (await db('clients').where({ agencyId, phone: conv.phone }).first())
    if (!lead) {
      const [row] = await db('clients')
        .insert({
          firstName: conv.firstName,
          lastName: conv.lastName,
          phone: conv.phone,
          email: null,
          idNum: `WS${conv.customerWaId.slice(-3)}`,
          leadSource,
          agencyId,
          userId,
          handlerId: userId,
          createdById: userId,
          lead: true,
          status: 'new',
          overQuota: false,
        })
        .returning('*')
      lead = row
      leadsCreated++
      console.log(`  + lead ${conv.customerName} id=${lead.id}`)
    } else {
      console.log(`  = lead ${conv.customerName} id=${lead.id} (exists)`)
    }

    const leadId = Number(lead.id)

    await db.transaction(async (trx) => {
      const conversationId = await findOrCreateConversation(trx, {
        agencyId,
        leadId,
        channel: 'whatsapp',
        businessPhoneNumberId,
        customerWaId: conv.customerWaId,
        customerName: conv.customerName,
      })

      const existingMsgs = await trx('inbox_messages').where({ conversationId }).count('id as c').first()
      if (Number(existingMsgs?.c ?? 0) > 0) {
        console.log(`  = conversation ${conversationId} already has messages — skipping`)
        return
      }
      conversationsCreated++

      await ensureParticipant(trx, {
        conversationId,
        agencyId,
        role: 'customer',
        waId: conv.customerWaId,
        displayName: conv.customerName,
        leadId,
      })
      await ensureParticipant(trx, {
        conversationId,
        agencyId,
        role: 'business',
        waId: businessPhoneNumberId,
        displayName: null,
        leadId: null,
      })

      const sorted = [...conv.messages].sort((a, b) => b.minutesAgo - a.minutesAgo)

      for (let i = 0; i < sorted.length; i++) {
        const msg = sorted[i]
        const at = atMinutesAgo(msg.minutesAgo)
        const externalId = fakeWamid(conv.customerWaId, i)

        if (msg.direction === 'inbound') {
          const { inserted } = await insertInboundMessage(trx, {
            conversationId,
            agencyId,
            leadId,
            channel: 'whatsapp',
            externalId,
            fromId: conv.customerWaId,
            toId: businessPhoneNumberId,
            type: 'text',
            text: msg.text,
            payload: {},
            rawPayload: { id: externalId, from: conv.customerWaId, timestamp: String(Math.floor(at.getTime() / 1000)), type: 'text', text: { body: msg.text } },
            channelTimestamp: at,
          })
          if (inserted) {
            await bumpConversationOnInbound(trx, conversationId, at, msg.text)
            messagesInserted++
          }
        } else {
          const { inserted } = await insertOutboundMessage(trx, {
            conversationId,
            agencyId,
            leadId,
            channel: 'whatsapp',
            externalId,
            fromId: businessPhoneNumberId,
            toId: conv.customerWaId,
            text: msg.text,
            sentByUserId: userId,
            channelTimestamp: at,
          })
          if (inserted) {
            await bumpConversationOnOutbound(trx, conversationId, at, msg.text)
            messagesInserted++
          }
        }
      }

      console.log(`  + conversation ${conversationId} (${conv.messages.length} messages)`)
    })
  }

  const convTotal = await db('inbox_conversations').where({ agencyId }).count('id as c').first()
  const msgTotal = await db('inbox_messages').where({ agencyId }).count('id as c').first()

  console.log('\nDone.')
  console.log(`  leads created: ${leadsCreated}`)
  console.log(`  conversations seeded: ${conversationsCreated}`)
  console.log(`  messages inserted: ${messagesInserted}`)
  console.log(`  agency inbox totals: ${convTotal?.c} conversations, ${msgTotal?.c} messages`)

  await db.destroy()
}

run().catch(async (e) => {
  console.error(e)
  await db.destroy()
  process.exit(1)
})
