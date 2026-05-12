import { AiRequestLog } from './types'

// Phase 0: structured console log only. The shape matches the future
// `ai_requests` table so the swap to a DB write is a single function-body change.
// Fire-and-forget: any error here must never bubble to the caller.
export function logAiRequest(record: Omit<AiRequestLog, 'createdAt'>): void {
  try {
    const entry: AiRequestLog = { ...record, createdAt: new Date().toISOString() }
    const level = process.env.AI_LOG_LEVEL ?? 'info'
    if (level === 'off') return
    console.info('[ai]', JSON.stringify(entry))
  } catch {
    // swallow
  }
}
