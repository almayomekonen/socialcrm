import { cache } from 'react'
import { db } from '@/config/db'

const FALLBACK_DEV_EMAILS = ['alamayo274@gmail.com']

export function devBypassEmails(): string[] {
  const fromEnv = (process.env.DEV_BYPASS_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return fromEnv.length ? fromEnv : FALLBACK_DEV_EMAILS
}

export function isDevBypassEmail(email?: string | null): boolean {
  if (!email) return false
  return devBypassEmails().includes(email.trim().toLowerCase())
}

export const getDevBypassAgencyIds = cache(async (): Promise<Set<number>> => {
  const emails = devBypassEmails()
  if (!emails.length) return new Set<number>()
  const placeholders = emails.map(() => '?').join(', ')
  const rows = await db('users').whereRaw(`lower("email") in (${placeholders})`, emails).select('agencyId')
  return new Set<number>(rows.map((r) => Number(r.agencyId)).filter((n) => Number.isFinite(n)))
})

export async function isDevBypassAgency(agencyId?: number | null): Promise<boolean> {
  if (!agencyId) return false
  return (await getDevBypassAgencyIds()).has(Number(agencyId))
}
