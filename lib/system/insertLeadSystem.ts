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

import type { Knex } from 'knex'
import { db } from '@/config/db'
import type { ClientCreateOrigin } from '@/lib/leads/createOrigin'
import { describeDbError, type DbErrorInfo } from '@/lib/system/dbErrorInfo'

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
  /** Durable create-path origin — required for all product system inserts. */
  createOrigin: ClientCreateOrigin
  lastName?: string | null
  phone?: string | null
  email?: string | null
  handlerId?: number
  lead?: boolean
  status?: string
}

/**
 * Optional error sink. The return contract is UNCHANGED (row or null) so every
 * existing caller keeps compiling and behaving identically; a caller that needs
 * to know WHY the insert failed — currently only the Meta lead webhook, which
 * persists it to `webhook_failures.error_detail` — passes this and receives a
 * PII-free description. Without it, a failure is indistinguishable from any
 * other, which is what made the 18 dropped production leads unexplainable.
 */
export type InsertLeadSystemOptions = {
  onError?: (info: DbErrorInfo) => void
  /**
   * Run the insert inside the caller's transaction (e.g. the agency quota lock).
   * Absent: the shared pool, exactly as before. A failed insert inside a
   * transaction aborts it, so a caller passing one returns right after a null.
   */
  executor?: Knex | Knex.Transaction
}

export async function insertLeadSystem(
  input: SystemLeadInput,
  options?: InsertLeadSystemOptions,
): Promise<any | null> {
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
    createOrigin: input.createOrigin,
  }

  try {
    const [lead] = await (options?.executor ?? db)('clients').insert(row).returning('*')
    return lead ?? null
  } catch (err) {
    // Structured first, so the caller can persist a real diagnosis; the raw
    // error still goes to the server log for anything the summary omits.
    const info = describeDbError(err)
    console.error(`[insertLeadSystem] insert failed: ${info.summary}`, err)
    try {
      options?.onError?.(info)
    } catch {
      // A broken error sink must never turn a failed insert into a thrown one.
    }
    return null
  }
}
