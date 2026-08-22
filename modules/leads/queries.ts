import { getPerms } from '@/db/filter'
import { getLeadsTable, hasAnyLeads, getFullLead } from '@/db/clients'
import { getDefaultSettings } from '@/db/usersNTeams'
import { normalizePhone } from '@/lib/leads/normalizeContact'
import { leadSourceLabel, leadSourceChannel, type LeadSourceChannel } from '@/lib/leads/leadSourceLabel'
import type { LeadFilters } from './filters'
import type { Roles } from '@/types/roles'

/**
 * Lead reads for the mobile presentation.
 *
 * Presentation-free, and NOT a second data layer: every row still comes from
 * `db/clients.getLeadsTable`, the same query the desktop table uses, with the
 * same `getPerms` scoping and the same agency scoping inside it. Mobile sees
 * exactly the rows desktop would — it just asks for them with filters and maps
 * them to a smaller shape.
 *
 * Follows the `modules/inbox` / `modules/today` shape: queries.ts holds the
 * sequencing, `filters.ts` holds the URL contract, `mobile/` holds the UI.
 */

export type MobileLeadRow = {
  id: number
  name: string
  phone: string | null
  /** E.164-ish digits (`972…`) for wa.me. Null when no usable number exists. */
  waPhone: string | null
  email: string | null
  status: string | null
  sourceLabel: string
  sourceChannel: LeadSourceChannel | null
  nextFollowUpAt: string | null
  lastActivityAt: string | null
  createdAt: string | null
  /** Precomputed by the SQL CTE — "התקשר עכשיו" / "עקוב אחרי" / "סגור עסקה". */
  nextAction: string | null
  /** SQL-computed overdue severity 1–3, or null when not overdue. */
  severity: number | null
  isNewBadge: boolean
  handlerName: string | null
}

/** Rows-per-page on mobile. Deliberately smaller than desktop's 100. */
export const MOBILE_LEAD_PAGE_SIZE = 30

export type LeadListViewer = { id: number; agencyId?: number; role: Roles }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toMobileRow(r: any): MobileLeadRow {
  const phone: string | null = r.phone ?? null
  return {
    id: Number(r.id),
    name: r.name || [r.firstName, r.lastName].filter(Boolean).join(' ') || '—',
    phone,
    waPhone: normalizePhone(phone),
    email: r.email ?? null,
    status: r.status ?? null,
    sourceLabel: leadSourceLabel(r.leadSource),
    sourceChannel: leadSourceChannel(r.leadSource),
    nextFollowUpAt: r.nextFollowUpAt ? new Date(r.nextFollowUpAt).toISOString() : null,
    lastActivityAt: r.lastActivityAt ? new Date(r.lastActivityAt).toISOString() : null,
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
    nextAction: r.nextAction ?? null,
    severity: r.severity == null ? null : Number(r.severity),
    isNewBadge: !!r.isNewBadge,
    handlerName: r.handlerName ?? null,
  }
}

/**
 * The mobile lead list.
 *
 * `page` is 1-based to match `getLeadsTable`'s `pageNum`. One extra row is
 * requested so "is there a next page" is answered without a second COUNT query
 * over a filtered set — a count that would double the work on every scroll.
 */
export async function getMobileLeadList(
  user: LeadListViewer,
  filters: LeadFilters,
  page = 1,
): Promise<{ rows: MobileLeadRow[]; hasMore: boolean; page: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { gotPermIds } = await getPerms(user as any)
  const settings = await getDefaultSettings(user.id)

  const query = {
    user,
    leads: true,
    gotPermIds,
    settings,
    filters: { q: filters.q || undefined, status: filters.status.length ? filters.status : undefined },
  }

  /**
   * OFFSET CORRECTNESS. `getLeadsTable` computes `offset = (pageNum - 1) * tableLimit`
   * (db/clients.ts). Asking it for `PAGE_SIZE + 1` rows as a "has more" probe
   * therefore also WIDENED the stride: batch 2 started at offset 31 while batch 1
   * had only shown 30, so exactly one lead was skipped at every boundary and was
   * unreachable from the phone. The probe must not decide the stride.
   *
   * Rows use the true page size, so the offset is `(page - 1) * PAGE_SIZE`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = ((await getLeadsTable({ ...query, params: { pageNum: page, tableLimit: MOBILE_LEAD_PAGE_SIZE } })) as any[]) ?? []

  /**
   * "Is there anything after this batch?" as a LIMIT 1 look-ahead. With the same
   * arithmetic, `pageNum = page * PAGE_SIZE + 1` and `tableLimit = 1` lands the
   * offset exactly on the first row AFTER this batch — one cheap row, and the
   * stride stays correct because it is a separate query.
   */
  const lookahead =
    rows.length < MOBILE_LEAD_PAGE_SIZE
      ? [] // a short batch is already the end; no probe needed
      : // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (((await getLeadsTable({ ...query, params: { pageNum: page * MOBILE_LEAD_PAGE_SIZE + 1, tableLimit: 1 } })) as any[]) ?? [])

  return { rows: rows.map(toMobileRow), hasMore: lookahead.length > 0, page }
}

/** Does this workspace have any leads at all? Distinguishes empty from filtered-empty. */
export async function agencyHasAnyLeads(user: LeadListViewer): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { gotPermIds } = await getPerms(user as any)
  return hasAnyLeads(user.agencyId as number, gotPermIds, user.role)
}

export type MobileLeadDetail = MobileLeadRow & {
  followUpNote: string | null
  lastOutcomeType: string | null
  leadSource: string | null
  secPhone: string | null
  firstName: string | null
  lastName: string | null
}

/**
 * One lead, for the mobile detail screen.
 *
 * `getFullLead` is the SAME read the desktop lead layout and summary page use,
 * so tenancy and permission behaviour are inherited rather than reimplemented.
 * Returns null when the lead is not visible to this viewer.
 */
export async function getMobileLeadDetail(leadId: number): Promise<MobileLeadDetail | null> {
  const row = await getFullLead({
    id: leadId,
    select: [
      'name',
      'firstName',
      'lastName',
      'phone',
      'secPhone',
      'email',
      'status',
      'leadSource',
      'nextFollowUpAt',
      'followUpNote',
      'lastOutcomeType',
      'lastActivityAt',
      'createdAt',
      'handlerId',
    ],
  })
  if (!row?.name && !row?.firstName) return null

  const base = toMobileRow({ ...row, id: leadId })
  return {
    ...base,
    followUpNote: row.followUpNote ?? null,
    lastOutcomeType: row.lastOutcomeType ?? null,
    leadSource: row.leadSource ?? null,
    secPhone: row.secPhone ?? null,
    firstName: row.firstName ?? null,
    lastName: row.lastName ?? null,
  }
}
