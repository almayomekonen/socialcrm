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

const inFlightLeads = new Map<string, boolean>()

export async function createLeadFromWebhook({ firstName, lastName, phone, email, leadId, agencyId, userId }: WebhookLeadInput) {
  if (inFlightLeads.has(leadId)) {
    console.log(`[FacebookWebhook][dedup][leadId=${leadId}] Duplicate in-flight lead — skipping`)
    return null
  }
  inFlightLeads.set(leadId, true)

  try {
    // Priority 1: dedup by leadId — stored as 'facebook:{leadId}' in leadSource (no externalId column)
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
      console.error(`[FacebookWebhook][create][leadId=${leadId}] upsertLead failed:`, lead)
      return null
    }

    console.log(`[FacebookWebhook][create][leadId=${leadId}] Lead created — id: ${lead.id}`)

    await createTask({ clientId: lead.id, title: 'ליד חדש מפייסבוק', userId, _system: true })

    console.log(`[FacebookWebhook][create][leadId=${leadId}] Follow-up created for lead id: ${lead.id}`)
    console.log(`[FacebookWebhook][success][leadId=${leadId}]`)

    return lead
  } finally {
    inFlightLeads.delete(leadId)
  }
}
