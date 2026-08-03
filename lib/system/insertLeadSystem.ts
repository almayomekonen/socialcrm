// SERVER-INTERNAL ONLY.
// This module must never be imported from a client component or from any
// file that can be reached by the client bundle. It performs an authenticated
// bypass of the quota system (and of requireUser) and is intended exclusively
// for trusted server callers such as webhooks, cron jobs, and admin tooling.
//
// The public `upsertLead` server action MUST NOT delegate to this helper.
// If a new caller is needed, route it through `upsertLead` (which enforces
// requireUser + field whitelist + quota) unless you are operating from a
// signed, server-verified context.

import { db } from '@/config/db'

export type SystemLeadInput = {
  agencyId: number
  userId: number
  firstName: string
  /**
   * The lead's national ID number. NULL when there is none — which is the norm
   * (the overwhelming majority of leads carry no idNum) and is REQUIRED for any
   * source that has no such number to report.
   *
   * A synthetic value is not a safe substitute: the `add_zeros_trigger` runs
   * `LPAD(idNum, 9, '0')`, and LPAD TRUNCATES anything longer than 9 — so any
   * scheme like `PREFIX_{externalId}` collapses to its first 9 characters and
   * collides on `clients_idNum_agencyId_unique`.
   */
  idNum: string | null
  leadSource: string | null
  overQuota: boolean
  lastName?: string | null
  phone?: string | null
  email?: string | null
  handlerId?: number
  lead?: boolean
  status?: string
}

export async function insertLeadSystem(input: SystemLeadInput): Promise<any | null> {
  const row = {
    firstName: input.firstName,
    lastName: input.lastName ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    idNum: input.idNum ?? null,
    leadSource: input.leadSource,
    agencyId: input.agencyId,
    userId: input.userId,
    handlerId: input.handlerId ?? input.userId,
    createdById: input.userId,
    lead: input.lead ?? true,
    status: input.status ?? 'new',
    overQuota: input.overQuota,
  }

  try {
    const [lead] = await db('clients').insert(row).returning('*')
    return lead ?? null
  } catch (err) {
    console.error('[insertLeadSystem] insert failed:', err)
    return null
  }
}
