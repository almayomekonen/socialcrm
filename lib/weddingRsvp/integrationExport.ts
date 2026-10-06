import { db } from '@/config/db'
import { WEDDING_AGENCY_ID } from '@/lib/weddingRsvp/config'
import { INVITE_TEXT_SQL, waSql } from '@/lib/weddingRsvp/integrationSql'

// ---------------------------------------------------------------------------
// 3. invited-guests (read-only export for the Wedding Manager backfill)
// ---------------------------------------------------------------------------

export async function exportInvitedGuests() {
  const rows = await db('inbox_messages as m')
    .join('inbox_conversations as c', 'c.id', 'm.conversationId')
    .leftJoin('clients as l', function () {
      this.on('l.id', '=', 'c.leadId').andOn('l.agencyId', '=', 'c.agencyId')
    })
    .where('m.agencyId', WEDDING_AGENCY_ID)
    .andWhere('m.direction', 'outbound')
    .andWhereNot('m.status', 'failed')
    .whereRaw(INVITE_TEXT_SQL('m'))
    .select(
      db.raw(`${waSql('c')} AS phone`),
      'l.name as lead_name',
      'c.customerName as profile_name',
      'm.status',
      'm.externalId',
      'm.createdAt',
      db.raw(`(m.metadata->>'kind' = 'wedding_invite') AS via_template`),
    )
    .orderBy('m.createdAt', 'asc')

  const latest = new Map<string, (typeof rows)[number]>()
  for (const r of rows) latest.set(r.phone, r) // ascending → the last one wins
  return [...latest.values()].map((r) => {
    const lead = (r.lead_name ?? '').trim()
    const profile = (r.profile_name ?? '').trim()
    return {
      phone: r.phone as string,
      name: lead || profile || null,
      nameSource: lead ? 'lead' : profile ? 'whatsapp_profile' : null,
      status: (r.status === 'delivered' || r.status === 'read' ? r.status : 'sent') as 'sent' | 'delivered' | 'read',
      wamid: (r.externalId as string | null) ?? null,
      sentAt: new Date(r.createdAt).toISOString(),
      via: r.via_template ? 'template' : 'phone',
    }
  })
}
