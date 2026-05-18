import { appendDocumentDiagStep } from '@/db/billing/documents'

export type DiagCtx = {
  documentId: number
  agencyId: number
}

export async function diagDb(ctx: DiagCtx | null, step: string, detail?: Record<string, unknown>): Promise<void> {
  if (!ctx) {
    try {
      console.log(`[diag] ${step}`, JSON.stringify(detail ?? {}))
    } catch {}
    return
  }
  try {
    await appendDocumentDiagStep(ctx.documentId, ctx.agencyId, step, detail)
  } catch (err) {
    try {
      console.log(`[diag-db-fail] ${step}`, err instanceof Error ? err.message : String(err))
    } catch {}
  }
}
