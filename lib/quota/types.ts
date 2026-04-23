export type Plan = 'free' | 'pro'

export class QuotaExceededError extends Error {
  readonly code = 'QUOTA_EXCEEDED'
  constructor(
    public current: number,
    public limit: number,
    public attempted: number,
  ) {
    super('Quota exceeded')
  }
}

export type QuotaErrorResult = {
  error: 'quota_exceeded'
  current: number
  limit: number
  attempted: number
}

export type QuotaStatus = {
  plan: Plan
  used: number
  limit: number | null
  remaining: number | null
  overQuotaCount: number
}
