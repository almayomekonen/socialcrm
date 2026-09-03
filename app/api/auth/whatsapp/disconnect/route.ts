import { NextRequest, NextResponse } from 'next/server'
import { requireAgencyAdmin, statusFor } from '@/lib/api/routeAuth'
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
  /**
   * ADMIN-ONLY, AND CHECKED BEFORE THE READ.
   *
   * This deletes every `whatsapp_connections` row for the agency, not the
   * caller's own — one POST from any authenticated session severed inbound
   * WhatsApp for an entire business. The guard sits above the audit read as
   * well as the delete: a caller who may not disconnect may not enumerate the
   * connection's metadata either.
   */
  const auth = await requireAgencyAdmin()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: statusFor(auth.reason) })
  }
  const user = auth.user

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
