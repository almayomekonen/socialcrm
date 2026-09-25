import { db } from '@/config/db'
import type { Recipient } from './types'
import { cardTrialChargeSoonQuery } from '@/db/payments/cardTrialEmails'
import { areSubscriptionChargesEnabled } from '@/lib/payments/grow/config'

const OWNER_SELECT = ['u.id as userId', 'u.agencyId as agencyId', 'u.email as email', 'u.firstName as firstName']

// One owner (earliest non-suspended ADMIN with an email) per agency.
function owners() {
  return db('users as u')
    .distinctOn('u.agencyId')
    .where('u.role', 'ADMIN')
    .where('u.suspended', false)
    .whereNotNull('u.email')
    .orderBy('u.agencyId')
    .orderBy('u.id')
    .select(OWNER_SELECT)
}

// The account owner of ONE agency. Used by event automations whose trigger only
// knows the agency (e.g. the Grow payment webhook, which never sees a userId).
// Same definition of "owner" as every scheduled audience above — earliest
// non-suspended ADMIN with an email — so recipient resolution stays consistent
// across the engine. Returns null when an agency has no eligible owner.
export async function agencyOwner(agencyId: number): Promise<Recipient | null> {
  const row = await owners().where('u.agencyId', agencyId).first()
  return (row as Recipient | undefined) ?? null
}

// All lifecycle-eligible owners — the audience for the educational journey drip.
// Per-recipient suppression + the daily cooldown are applied downstream by the
// dispatcher; this just enumerates one owner per agency.
export function lifecycleOwners(): Promise<Recipient[]> {
  return owners() as unknown as Promise<Recipient[]>
}

// Signup age ≥ 3d (owner.createdAt ≈ agency creation) AND no Facebook page.
export function ownersMissingFacebook(): Promise<Recipient[]> {
  return owners()
    .whereRaw(`u."createdAt" <= NOW() - INTERVAL '3 days'`)
    .whereNotExists(db('facebook_pages as fp').whereRaw('fp.agency_id = u."agencyId"')) as Promise<Recipient[]>
}

export function ownersMissingWhatsapp(): Promise<Recipient[]> {
  return owners()
    .whereRaw(`u."createdAt" <= NOW() - INTERVAL '3 days'`)
    .whereNotExists(db('whatsapp_connections as wc').whereRaw('wc.agency_id = u."agencyId"')) as Promise<Recipient[]>
}

export function ownersWithFirstLead(): Promise<Recipient[]> {
  return owners().whereExists(db('clients as c').whereRaw('c."agencyId" = u."agencyId"').where('c.lead', true)) as Promise<
    Recipient[]
  >
}

// Candidates for the inactivity nudge (agency old enough); the inactivity itself
// is decided by the isInactiveOwner condition (the temporary login-trail signal).
export function inactiveOwnerCandidates(): Promise<Recipient[]> {
  return owners().whereRaw(`u."createdAt" <= NOW() - INTERVAL '14 days'`) as Promise<Recipient[]>
}

/**
 * The no-card "upgrade before access closes" reminder. Card-trial agencies are
 * excluded: their access does not close, they are charged automatically, and
 * they get card_trial_charge_reminder instead (lib/emailAutomations/cardTrial.ts).
 */
export function ownersTrialEnding(): Promise<Recipient[]> {
  return owners()
    .join('_trial_status as ts', 'ts.agencyId', 'u.agencyId')
    .where('ts.status', 'TRIAL_ACTIVE')
    .where('ts.daysRemaining', '<=', 3)
    .whereNotExists((q) =>
      q.select(1).from('billing_payment_methods as pm').whereRaw('pm."agencyId" = u."agencyId" AND pm."confirmedAt" IS NOT NULL'),
    ) as Promise<Recipient[]>
}

/**
 * Owners whose card trial is charged in ~2 days — see db/payments/cardTrialEmails.ts.
 * Empty while token charges are disabled: an email must never announce a charge
 * the system would not make.
 */
export async function ownersCardTrialChargeSoon(): Promise<Recipient[]> {
  if (!areSubscriptionChargesEnabled()) return []
  return (await cardTrialChargeSoonQuery()) as unknown as Recipient[]
}
