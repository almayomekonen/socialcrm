import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/db/auth'
import { deleteWhatsappConnectionsForAgency, getWhatsappConnectionAuditForAgency } from '@/db/whatsapp'
import { track } from '@/lib/analytics/track'

/**
 * User-initiated WhatsApp disconnect — the ONLY delete path for
 * `whatsapp_connections` in application code.
 *
 * The row is hard deleted, so the audit read MUST happen before the delete: once
 * it is gone there is nothing left to describe it. A production agency
 * disconnected an operational, lead-producing number and left no trace of when,
 * who, or from where; `whatsapp_disconnected` is now that record.
 *
 * Props carry no `access_token` and no `phone_number_id` — see
 * `getWhatsappConnectionAuditForAgency`. `initiator: 'user'` distinguishes this
 * from any future system-initiated removal, which must emit the same event with
 * its own source rather than inventing a second name.
 */
export async function POST(_req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.agencyId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const audit = await getWhatsappConnectionAuditForAgency(user.agencyId)

  const deleted = await deleteWhatsappConnectionsForAgency(user.agencyId)

  /**
   * Not awaited: telemetry must never delay or fail the disconnect the user
   * asked for. `track()` swallows its own errors.
   */
  void track({
    agencyId: user.agencyId,
    userId: user.id,
    event: 'whatsapp_disconnected',
    props: {
      source: 'settings_disconnect',
      initiator: 'user',
      deletedCount: deleted ?? 0,
      connectionId: audit?.id ?? null,
      hadWaba: !!audit?.waba_id,
      onboardingType: audit?.onboarding_type ?? null,
      healthStatus: audit?.health_status ?? null,
    },
  })

  return NextResponse.json({ ok: true })
}
