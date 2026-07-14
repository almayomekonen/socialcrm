import { db } from '@/config/db'
import { insertLeadSystem } from '@/lib/system/insertLeadSystem'
import { createTask } from '@/actions/tasks'
import { getQuotaStatus } from '@/lib/quota'

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
  const digits = rawPhone?.replace(/\D/g, '') ?? ''
  const phone = digits.length >= 9 ? (digits.startsWith('972') ? digits : '972' + digits.replace(/^0/, '')) : null

  const existingByLeadId = await db('clients')
    .where({ leadSource: `facebook:${leadId}` })
    .first()
  if (existingByLeadId) {
    console.log(`[FacebookWebhook][dedup][leadId=${leadId}] Duplicate by leadId — skipping. lead id: ${existingByLeadId.id}`)
    return existingByLeadId
  }

  if (phone) {
    const existingByPhone = await db('clients').where({ phone }).whereLike('leadSource', 'facebook:%').first()
    if (existingByPhone) {
      console.log(`[FacebookWebhook][dedup][leadId=${leadId}] Duplicate by phone — skipping. lead id: ${existingByPhone.id}`)
      return existingByPhone
    }
  }

  const quota = await getQuotaStatus(agencyId)
  const overQuota = quota.plan === 'free' && quota.limit !== null && quota.used >= quota.limit

  const lead = await insertLeadSystem({
    firstName,
    lastName,
    phone,
    email,
    idNum: `FB_${leadId}`,
    lead: true,
    leadSource: `facebook:${leadId}`,
    agencyId,
    handlerId: userId,
    userId,
    overQuota,
  })

  if (!lead) {
    const concurrentLead = await db('clients')
      .where({ leadSource: `facebook:${leadId}` })
      .first()
    if (concurrentLead) {
      console.log(`[FacebookWebhook][dedup][leadId=${leadId}] Concurrent insert resolved — lead id: ${concurrentLead.id}`)
      return concurrentLead
    }
    console.error(`[FacebookWebhook][create][leadId=${leadId}] insertLeadSystem failed`)
    return null
  }

  console.log(`[FacebookWebhook][create][leadId=${leadId}] Lead created — id: ${lead.id}`)

  await createTask({ clientId: lead.id, title: 'ליד חדש מפייסבוק', userId, _system: true })

  console.log(`[FacebookWebhook][success][leadId=${leadId}]`)

  return lead
}
