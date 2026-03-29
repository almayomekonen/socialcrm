import { db } from '@/config/db'
import { upsertLead } from '@/actions/clients'
import { createTask } from '@/actions/tasks'

type WhatsappWebhookLeadInput = {
  firstName: string
  lastName: string | null
  phone: string | null
  messageId: string
  agencyId: number
  userId: number
}

export async function createLeadFromWhatsappWebhook({
  firstName,
  lastName,
  phone: rawPhone,
  messageId,
  agencyId,
  userId,
}: WhatsappWebhookLeadInput) {
  const digits = rawPhone?.replace(/\D/g, '') ?? ''
  const phone = digits.length >= 9 ? (digits.startsWith('972') ? digits : '972' + digits.replace(/^0/, '')) : null

  // Priority 1: dedup by messageId — exact match on leadSource
  const existingByMessageId = await db('clients')
    .where({ leadSource: `whatsapp:${messageId}` })
    .first()
  if (existingByMessageId) {
    console.log(`[WhatsappWebhook][dedup][msgId=${messageId}] Duplicate by messageId — skipping. lead id: ${existingByMessageId.id}`)
    return existingByMessageId
  }

  // Priority 2: dedup by phone — global across all sources
  if (phone) {
    const existingByPhone = await db('clients').where({ phone }).first()
    if (existingByPhone) {
      console.log(`[WhatsappWebhook][dedup][msgId=${messageId}] Duplicate by phone — skipping. lead id: ${existingByPhone.id}`)
      return existingByPhone
    }
  }

  const lead = await upsertLead(
    userId,
    {
      firstName,
      lastName,
      phone,
      email: null,
      idNum: `WA_${messageId}`,
      lead: true,
      leadSource: `whatsapp:${messageId}`,
      agencyId,
      handlerId: userId,
      _system: true,
    },
    null,
    false,
  )

  if (!lead || lead.err) {
    // Concurrent insert guard — same as Facebook pattern
    const concurrentLead = await db('clients')
      .where({ leadSource: `whatsapp:${messageId}` })
      .first()
    if (concurrentLead) {
      console.log(`[WhatsappWebhook][dedup][msgId=${messageId}] Concurrent insert resolved — lead id: ${concurrentLead.id}`)
      return concurrentLead
    }
    console.error(`[WhatsappWebhook][create][msgId=${messageId}] upsertLead failed:`, lead)
    return null
  }

  console.log(`[WhatsappWebhook][create][msgId=${messageId}] Lead created — id: ${lead.id}`)

  await createTask({ clientId: lead.id, title: 'ליד חדש מוואטסאפ', userId, _system: true })

  console.log(`[WhatsappWebhook][success][msgId=${messageId}]`)

  return lead
}
