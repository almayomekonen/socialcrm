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
  idNum: string
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
    idNum: input.idNum,
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
