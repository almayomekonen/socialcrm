import { db } from '@/config/db'
import { upsertLead } from '@/actions/clients'
import { createTask } from '@/actions/tasks'

type WebhookLeadInput = {
  firstName: string
  lastName: string | null
  phone: string | null
  email: string | null
  leadId: string
  agencyId: number
  userId: number
}

export async function createLeadFromWebhook({
  firstName,
  lastName,
  phone: rawPhone,
  email,
  leadId,
  agencyId,
  userId,
}: WebhookLeadInput) {
  // Normalize phone → 972XXXXXXXXX before any dedup check or insert
  const digits = rawPhone?.replace(/\D/g, '') ?? ''
  const phone = digits.length >= 9 ? (digits.startsWith('972') ? digits : '972' + digits.replace(/^0/, '')) : null

  // Priority 1: dedup by leadId — stored as 'facebook:{leadId}' in leadSource
  const existingByLeadId = await db('clients')
    .where({ leadSource: `facebook:${leadId}` })
    .first()
  if (existingByLeadId) {
    console.log(`[FacebookWebhook][dedup][leadId=${leadId}] Duplicate by leadId — skipping. lead id: ${existingByLeadId.id}`)
    return existingByLeadId
  }

  // Priority 2: fallback dedup by phone — only when phone is present
  if (phone) {
    const existingByPhone = await db('clients').where({ phone }).whereLike('leadSource', 'facebook:%').first()
    if (existingByPhone) {
      console.log(`[FacebookWebhook][dedup][leadId=${leadId}] Duplicate by phone — skipping. lead id: ${existingByPhone.id}`)
      return existingByPhone
    }
  }

  const lead = await upsertLead(
    userId,
    {
      firstName,
      lastName,
      phone,
      email,
      idNum: `FB_${leadId}`,
      lead: true,
      leadSource: `facebook:${leadId}`,
      agencyId,
      handlerId: userId,
      _system: true,
    },
    null,
    false,
  )

  if (!lead || lead.err) {
    // The unique index on clients."leadSource" means a concurrent insert for the same leadId
    // will cause upsertLead to fail. Re-check the DB before treating this as a real error.
    const concurrentLead = await db('clients')
      .where({ leadSource: `facebook:${leadId}` })
      .first()
    if (concurrentLead) {
      console.log(`[FacebookWebhook][dedup][leadId=${leadId}] Concurrent insert resolved — lead id: ${concurrentLead.id}`)
      return concurrentLead
    }
    console.error(`[FacebookWebhook][create][leadId=${leadId}] upsertLead failed:`, lead)
    return null
  }

  console.log(`[FacebookWebhook][create][leadId=${leadId}] Lead created — id: ${lead.id}`)

  await createTask({ clientId: lead.id, title: 'ליד חדש מפייסבוק', userId, _system: true })

  console.log(`[FacebookWebhook][success][leadId=${leadId}]`)

  return lead
}
