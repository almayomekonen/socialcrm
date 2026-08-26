import { db } from '@/config/db'
import { checkFacebookConnection, repairFacebookConnection } from '@/lib/facebook/health'
import { markFacebookDisconnectedAndNotify } from '@/lib/facebook/integrationNotifications'
import { resolveWhatsappHealth } from '@/lib/whatsapp/operationalStatus'
import { notifyEvent } from '@/lib/notifications/emit'

/**
 * Scheduled connection health for both Meta channels.
 *
 * THE PROBLEM. Both providers already have a truthful health model —
 * `checkFacebookConnection` and `resolveWhatsappHealth` — and neither ran on a
 * schedule. They were evaluated when a customer opened Settings, or reactively
 * after a webhook had already failed. So a dead token was discovered by a human,
 * usually after leads had been lost. This sweep is the missing clock; it invents
 * no new detection logic and calls exactly the functions the settings page does.
 *
 * NOTIFY ON TRANSITIONS, NEVER ON STATE. A broken connection observed hourly is
 * one problem, not twenty-four. Facebook gets this for free —
 * `markFacebookDisconnectedAndNotify` only emits when the row was not already
 * `token_expired`. WhatsApp gets it from the persisted `health_status` column,
 * compared before writing. A connection that is merely still broken is silent.
 *
 * CREDENTIALS ARE NEVER MUTATED. The one repair invoked is
 * `repairFacebookConnection`, and only when the token is VALID but the webhook
 * subscription has gone missing — it re-subscribes Page fields and touches no
 * credential. A dead token is reported, never "fixed": only the customer can
 * reconnect, and pretending otherwise would hide the problem.
 *
 * TENANT ISOLATION is inherent: every row carries its own agency and every
 * notification is emitted with that row's `agency_id`. Nothing is aggregated
 * across tenants.
 */

export type HealthSweepResult = {
  facebookChecked: number
  facebookDisconnected: number
  facebookRepaired: number
  whatsappChecked: number
  whatsappTransitioned: number
  errors: number
}

/** WhatsApp states that mean "the customer needs to do something". */
const WHATSAPP_BROKEN_STATES = new Set(['disconnected', 'token', 'webhook', 'restricted'])

async function sweepFacebook(result: HealthSweepResult): Promise<void> {
  const pages = (await db('facebook_pages').select('id', 'agency_id', 'page_id', 'page_access_token', 'health_status')) as {
    id: number
    agency_id: number
    page_id: string
    page_access_token: string
    health_status: string
  }[]

  for (const page of pages) {
    try {
      result.facebookChecked++
      const health = await checkFacebookConnection(page.page_id, page.page_access_token)

      if (health.needsReconnect) {
        // Transition-guarded inside: silent when already token_expired.
        const emitted = await markFacebookDisconnectedAndNotify({
          id: page.id,
          agency_id: page.agency_id,
          page_id: page.page_id,
        })
        if (emitted === 'emitted') result.facebookDisconnected++
        continue
      }

      // Token is good but the Page lost its webhook subscription — the one
      // condition an automatic, credential-free repair can genuinely fix.
      if (!health.subscribed) {
        const repair = await repairFacebookConnection(page.page_id)
        if (repair.repaired) result.facebookRepaired++
        continue
      }

      // Recovered: record it so the settings page and the reconnect banner agree.
      if (page.health_status !== 'healthy') {
        await db('facebook_pages').where({ id: page.id }).update({ health_status: 'healthy', health_checked_at: new Date() })
      } else {
        await db('facebook_pages').where({ id: page.id }).update({ health_checked_at: new Date() })
      }
    } catch (err) {
      result.errors++
      console.error('[healthSweep][facebook] page check failed', { pageId: page.page_id, err: String(err) })
    }
  }
}

async function sweepWhatsapp(result: HealthSweepResult): Promise<void> {
  const connections = (await db('whatsapp_connections').select(
    'id',
    'agency_id',
    'phone_number_id',
    'access_token',
    'waba_id',
    'health_status',
  )) as {
    id: number
    agency_id: number
    phone_number_id: string
    access_token: string
    waba_id: string | null
    health_status: string
  }[]

  for (const conn of connections) {
    try {
      result.whatsappChecked++
      // `resolveWhatsappHealth` resolves the sealed token itself.
      const health = await resolveWhatsappHealth(
        { phone_number_id: conn.phone_number_id, access_token: conn.access_token, waba_id: conn.waba_id },
        conn.agency_id,
      )

      const previous = conn.health_status ?? 'unknown'
      const next = health.primary
      await db('whatsapp_connections').where({ id: conn.id }).update({ health_status: next, health_checked_at: new Date() })

      // A transition INTO a broken state is news. Staying broken is not, and
      // recovering is visible in the product without an interruption.
      const becameBroken = WHATSAPP_BROKEN_STATES.has(next) && !WHATSAPP_BROKEN_STATES.has(previous)
      if (!becameBroken) continue

      result.whatsappTransitioned++
      const at = new Date()
      await notifyEvent({
        type: 'integration.disconnected',
        agencyId: conn.agency_id,
        entityType: 'integration',
        entityId: conn.id,
        actorUserId: null,
        occurredAt: at,
        payload: { provider: 'whatsapp', disconnectedAt: at.getTime() },
      })
    } catch (err) {
      result.errors++
      console.error('[healthSweep][whatsapp] connection check failed', {
        phoneNumberId: conn.phone_number_id,
        err: String(err),
      })
    }
  }
}

/**
 * One full sweep. Idempotent: it reads live provider state and writes the same
 * verdict for the same reality, so running it twice changes nothing and notifies
 * nothing the second time. One failing connection never stops the rest.
 */
export async function runConnectionHealthSweep(): Promise<HealthSweepResult> {
  const result: HealthSweepResult = {
    facebookChecked: 0,
    facebookDisconnected: 0,
    facebookRepaired: 0,
    whatsappChecked: 0,
    whatsappTransitioned: 0,
    errors: 0,
  }

  await sweepFacebook(result)
  await sweepWhatsapp(result)

  console.log('[healthSweep] pass complete', result)
  return result
}
