import { db } from '@/config/db'
import { requireUser } from '@/lib/requireUser'
import type { IssuerData } from '@/lib/billing/issuer/fields'

/**
 * Issuer identity reads/writes.
 *
 * The issuer columns live ON the `agencies` table (not a dedicated
 * issuer-profiles table) because Phase 1 is one-business-per-agency.
 * This module exists to:
 *   - Encapsulate the column subset PDF/email actually need (no
 *     pulling pkg/plan/etc into the renderer).
 *   - Provide one place to swap to a separate table later if/when
 *     multi-business-per-agency becomes real — no caller-side refactor.
 *
 * Tenant scope: every read and write asserts that the caller is acting
 * on their own agency. Cross-tenant reads return null; cross-tenant
 * writes throw. This is symmetric with the rest of the billing DB
 * layer's defense-in-depth posture.
 */

/** Columns selected by getIssuer — kept inline for clarity. */
const ISSUER_COLUMNS = [
  'name',
  'businessType',
  'taxId',
  'address',
  'phone',
  'email',
  'img',
  'country',
  'defaultCurrency',
  'locale',
  'docNumberFormat',
  'bankDetails',
] as const

/**
 * Whitelisted writable keys. Tier 3 fields (country / defaultCurrency /
 * locale / docNumberFormat / bankDetails) are intentionally NOT writable
 * via this helper — they exist as DB defaults with no UI on day one.
 * When/if we expose them later, add them here.
 */
const WRITABLE_KEYS = ['name', 'businessType', 'taxId', 'address', 'phone', 'email', 'img'] as const

export async function getIssuer(agencyId: number): Promise<IssuerData | null> {
  const user = await requireUser()
  if (user.agencyId !== agencyId) return null

  const row = await db('agencies').where({ id: agencyId }).first(...ISSUER_COLUMNS)
  if (!row) return null
  return normalizeIssuer(row)
}

/**
 * System-level issuer read for callers that operate outside a request scope
 * (e.g. the deferred PDF render path) or that have already established tenant
 * authority by a different route (e.g. server actions that derive agencyId
 * from the authenticated user).
 *
 * Skips requireUser(). Callers MUST have an independent reason to trust the
 * agencyId argument — pass through invoice agency, action user.agencyId, etc.
 * Do NOT use this from any path that takes agencyId from untrusted input.
 */
export async function getIssuerForRender(agencyId: number): Promise<IssuerData | null> {
  const row = await db('agencies').where({ id: agencyId }).first(...ISSUER_COLUMNS)
  if (!row) return null
  return normalizeIssuer(row)
}

export async function updateIssuer(agencyId: number, partial: Partial<IssuerData>): Promise<void> {
  const user = await requireUser()
  if (user.agencyId !== agencyId) {
    throw new Error('billing.issuer.cross_tenant_write')
  }

  // Whitelist write: only allow keys we deliberately expose. Caller
  // sending extra keys (e.g. plan, pkg) is silently ignored — not an
  // error, but never written.
  const safeUpdate: Record<string, unknown> = {}
  for (const key of WRITABLE_KEYS) {
    if (key in partial) {
      safeUpdate[key] = (partial as Record<string, unknown>)[key]
    }
  }

  if (Object.keys(safeUpdate).length === 0) return // no-op

  await db('agencies').where({ id: agencyId }).update(safeUpdate)
}

/**
 * Convert a raw DB row into the typed IssuerData shape. Nulls stay as
 * nulls for Tier 1+2 fields (user may not have filled them yet). Tier
 * 3 fields fall back to their schema defaults if somehow missing.
 */
function normalizeIssuer(raw: Record<string, unknown>): IssuerData {
  return {
    name: raw.name == null ? null : String(raw.name),
    businessType: (raw.businessType as IssuerData['businessType']) ?? null,
    taxId: raw.taxId == null ? null : String(raw.taxId),
    address: raw.address == null ? null : String(raw.address),
    phone: raw.phone == null ? null : String(raw.phone),
    email: raw.email == null ? null : String(raw.email),
    img: raw.img == null ? null : Number(raw.img),
    country: String(raw.country ?? 'IL'),
    defaultCurrency: String(raw.defaultCurrency ?? 'ILS'),
    locale: String(raw.locale ?? 'he'),
    docNumberFormat: String(raw.docNumberFormat ?? 'YYYY-NNNN'),
    bankDetails: (raw.bankDetails as Record<string, unknown>) ?? {},
  }
}
