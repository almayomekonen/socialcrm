import { db } from '@/config/db'
import type { Recipient } from './types'

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

export async function getAgencyOwner(agencyId: number): Promise<Recipient | null> {
  const row = await db('users as u')
    .where('u.agencyId', agencyId)
    .where('u.role', 'ADMIN')
    .where('u.suspended', false)
    .whereNotNull('u.email')
    .orderBy('u.id')
    .first(OWNER_SELECT)
  return (row as Recipient) ?? null
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
  return owners().whereExists(
    db('clients as c').whereRaw('c."agencyId" = u."agencyId"').where('c.lead', true),
  ) as Promise<Recipient[]>
}

// Candidates for the inactivity nudge (agency old enough); the inactivity itself
// is decided by the isInactiveOwner condition (the temporary login-trail signal).
export function inactiveOwnerCandidates(): Promise<Recipient[]> {
  return owners().whereRaw(`u."createdAt" <= NOW() - INTERVAL '14 days'`) as Promise<Recipient[]>
}

export function ownersTrialEnding(): Promise<Recipient[]> {
  return owners()
    .join('_trial_status as ts', 'ts.agencyId', 'u.agencyId')
    .where('ts.status', 'TRIAL_ACTIVE')
    .where('ts.daysRemaining', '<=', 3) as Promise<Recipient[]>
}
