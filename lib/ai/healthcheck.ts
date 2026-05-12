import { z } from 'zod'
import { runStructured } from './router'
import { ProviderName } from './types'

export type HealthCheckResult = {
  provider: ProviderName | 'none'
  model: string | null
  ok: boolean
  latencyMs: number
  reason?: string
}

const HealthSchema = z.object({
  word: z.string().describe('המילה שלום בעברית בלבד, ללא ניקוד'),
})

export async function runHealthCheck(): Promise<HealthCheckResult[]> {
  const t0 = Date.now()
  const res = await runStructured({
    kind: 'health.check',
    schema: HealthSchema,
    system: 'אתה משיב במילה אחת בעברית בלבד.',
    user: 'החזר אובייקט שמכיל את המילה: שלום',
    bypassAllowlist: true,
  })

  if (res.ok === true) {
    return [
      {
        provider: res.provider,
        model: res.model,
        ok: true,
        latencyMs: res.latencyMs,
      },
    ]
  }

  return [
    {
      provider: 'none',
      model: null,
      ok: false,
      latencyMs: res.latencyMs ?? Date.now() - t0,
      reason: res.reason,
    },
  ]
}
