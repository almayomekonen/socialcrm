'use server'

import { requireUser } from '@/lib/requireUser'
import { runHealthCheck } from '@/lib/ai/healthcheck'

export async function aiHealthCheck() {
  const user = await requireUser()
  if (user.role !== 'ADMIN') return { ok: false as const, reason: 'forbidden' as const }
  const results = await runHealthCheck()
  return { ok: true as const, results }
}
