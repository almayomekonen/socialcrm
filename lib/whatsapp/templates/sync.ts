import { listTemplatesFromMeta, type MetaTemplate } from './graph'
import { mapRejectionReason, mapTemplateStatus } from './statusCopy'
import { upsertFromMeta } from '@/db/whatsappTemplates'
import type { MetaComponent } from './types'

/**
 * Reconciliation — the backstop for missed webhooks (RFC §5–§6). Meta is the
 * source of truth; we list a WABA's templates and upsert each into the local
 * projection by Meta identity (idempotent). It only READS from Meta and WRITES
 * local rows — it never sends a message or triggers automation.
 */

/** Pull the BODY text out of a Meta component array (for the list preview). */
export function extractBodyText(components: unknown): string {
  if (!Array.isArray(components)) return ''
  const body = components.find((c) => (c as { type?: string })?.type === 'BODY') as { text?: string } | undefined
  return body?.text ?? ''
}

export type ReconcileDeps = {
  list?: typeof listTemplatesFromMeta
  upsert?: typeof upsertFromMeta
}

/**
 * Reconcile one WABA. Idempotent: `upsertFromMeta` conflicts on
 * (wabaId, name, language), so re-running converges to the same rows.
 */
export async function reconcileWabaTemplates(
  input: { agencyId: number; wabaId: string; accessToken: string },
  deps: ReconcileDeps = {},
): Promise<{ scanned: number; upserted: number }> {
  const list = deps.list ?? listTemplatesFromMeta
  const upsert = deps.upsert ?? upsertFromMeta

  const res = await list(input.wabaId, input.accessToken)
  if (!res.ok) return { scanned: 0, upserted: 0 }

  let upserted = 0
  for (const t of res.templates as MetaTemplate[]) {
    const status = mapTemplateStatus(t.status)
    await upsert({
      agencyId: input.agencyId,
      wabaId: input.wabaId,
      name: t.name,
      language: t.language,
      category: t.category,
      status,
      metaTemplateId: t.id,
      rejectionReason: status === 'rejected' ? mapRejectionReason(t.rejected_reason).key : null,
      qualityRating: t.quality_score?.score ?? null,
      bodyText: extractBodyText(t.components),
      components: (t.components ?? []) as MetaComponent[],
    })
    upserted++
  }
  return { scanned: res.templates.length, upserted }
}
