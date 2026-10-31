/**
 * AI_USAGE_LEDGER: write one `ai_usage_events` row per provider request.
 * ABSENCE BLOCKS: only the exact value `1` writes. Write-only — nothing reads
 * the ledger to decide anything yet. Read per call, never cached.
 */
export function isAiUsageLedgerEnabled(): boolean {
  return process.env.AI_USAGE_LEDGER === '1'
}
