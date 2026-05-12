'use server'

import { revalidateTag } from 'next/cache'
import { requireUser } from '@/lib/requireUser'
import { getFullLead } from '@/db/clients'
import { leadIntelTag } from './leadIntelligence'

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000
const RATE_LIMIT_MAX = 3

const refreshLog = new Map<string, number[]>()

export type RefreshLeadIntelligenceResult = { ok: true } | { ok: false; reason: 'invalid-input' | 'forbidden' | 'rate-limited' }

export async function refreshLeadIntelligence(leadIdRaw: number | string): Promise<RefreshLeadIntelligenceResult> {
  const leadId = Number(leadIdRaw)
  if (!Number.isFinite(leadId) || leadId <= 0) {
    return { ok: false, reason: 'invalid-input' }
  }

  const user = await requireUser()

  const lead = await getFullLead({ id: leadId, select: ['agencyId'] })
  if (!lead) return { ok: false, reason: 'forbidden' }

  const key = `${user.id}:${leadId}`
  const now = Date.now()
  const recent = (refreshLog.get(key) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  if (recent.length >= RATE_LIMIT_MAX) {
    refreshLog.set(key, recent)
    return { ok: false, reason: 'rate-limited' }
  }
  recent.push(now)
  refreshLog.set(key, recent)

  revalidateTag(leadIntelTag(leadId), 'default')
  return { ok: true }
}
