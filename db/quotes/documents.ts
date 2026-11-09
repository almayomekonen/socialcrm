import { db } from '@/config/db'

/**
 * sales_quote_documents: one row per render ATTEMPT of a quote's PDF.
 *
 * The database, not this code, guarantees "one render at a time" and "one
 * current PDF" (two partial unique indexes, migration 20261111120000). The claim
 * below leans on them instead of a check-then-insert, so two concurrent callers
 * cannot both start a render.
 *
 * Failed rows stay as history: their count is the retry budget.
 *
 * System-level: every caller passes the agency it resolved from trusted context.
 */

const T = 'sales_quote_documents'

/** The render and upload finish inside one 60-second function; anything older belongs to a process that died. */
export const QUOTE_RENDER_STALE_MS = 2 * 60 * 1000
/** Attempts before the owner is told it failed. Each failed row is one attempt. */
export const QUOTE_RENDER_MAX_ATTEMPTS = 3

export type QuoteDocumentRow = {
  id: number
  agencyId: number
  quoteId: number
  status: 'rendering' | 'ready' | 'failed'
  path: string
  contentHash: string | null
  byteSize: number | null
  failureReason: string | null
  isCurrent: boolean
}

/**
 * Atomically start a render. Null when a render is already running or the quote
 * already has a current PDF, in which case the caller does nothing.
 */
export async function claimQuoteRender(input: { agencyId: number; quoteId: number; path: string; renderedByUserId: number | null }): Promise<number | null> {
  const r = await db.raw(
    `
    INSERT INTO ${T} ("agencyId","quoteId",status,path,"renderedByUserId")
    SELECT :agencyId,:quoteId,'rendering',:path,:renderedByUserId
    WHERE NOT EXISTS (SELECT 1 FROM ${T} WHERE "quoteId" = :quoteId AND "isCurrent" = true)
    ON CONFLICT ("quoteId") WHERE status = 'rendering' DO NOTHING
    RETURNING id
    `,
    { ...input, renderedByUserId: input.renderedByUserId },
  )
  const id = r?.rows?.[0]?.id
  return id == null ? null : Number(id)
}

/** A `rendering` row older than the stale limit belonged to a process that died: it becomes a failed attempt. */
export async function closeStaleQuoteRenders(agencyId: number, quoteId: number, nowMs: number): Promise<number> {
  return db(T)
    .where({ agencyId, quoteId, status: 'rendering' })
    .andWhere('createdAt', '<', new Date(nowMs - QUOTE_RENDER_STALE_MS))
    .update({ status: 'failed', failureReason: 'stale_render', updatedAt: db.fn.now() })
}

/**
 * Terminal: this row becomes the quote's one current PDF. False when the row is
 * no longer `rendering` (it was closed as stale while this process ran), in
 * which case nothing changes and the caller reports nothing.
 */
export async function markQuoteDocumentReady(input: { documentId: number; agencyId: number; quoteId: number; contentHash: string; byteSize: number }): Promise<boolean> {
  const { documentId, agencyId, quoteId } = input
  return db.transaction(async (trx) => {
    const row = await trx(T).where({ id: documentId, agencyId, quoteId }).forUpdate().first('status')
    if (row?.status !== 'rendering') return false
    await trx(T).where({ agencyId, quoteId, isCurrent: true }).update({ isCurrent: false, updatedAt: trx.fn.now() })
    await trx(T)
      .where({ id: documentId, agencyId })
      .update({ status: 'ready', isCurrent: true, contentHash: input.contentHash, byteSize: input.byteSize, readyAt: trx.fn.now(), updatedAt: trx.fn.now() })
    return true
  })
}

export async function markQuoteDocumentFailed(documentId: number, agencyId: number, reason: string): Promise<void> {
  await db(T).where({ id: documentId, agencyId, status: 'rendering' }).update({ status: 'failed', failureReason: reason, updatedAt: db.fn.now() })
}

/** The quote's current PDF's handle (its SHA-256), or null when it has none. */
export async function currentQuoteDocumentHandle(agencyId: number, quoteId: number): Promise<string | null> {
  const row = (await db(T).where({ agencyId, quoteId, isCurrent: true, status: 'ready' }).first('contentHash')) as { contentHash: string | null } | undefined
  return row?.contentHash ?? null
}

export async function hasLiveQuoteRender(agencyId: number, quoteId: number): Promise<boolean> {
  return Boolean(await db(T).where({ agencyId, quoteId, status: 'rendering' }).first('id'))
}

export async function failedQuoteRenderCount(agencyId: number, quoteId: number): Promise<number> {
  const row = await db(T).where({ agencyId, quoteId, status: 'failed' }).count<{ count: string }>('id as count').first()
  return Number(row?.count ?? 0)
}

/**
 * The current PDF for a download handle, inside the caller's own agency. The
 * handle is the document's SHA-256, so a link carries no CRM identifier.
 */
export async function findCurrentQuoteDocumentByHandle(agencyId: number, handle: string): Promise<{ quoteId: number; path: string } | null> {
  const row = (await db(T).where({ agencyId, contentHash: handle, isCurrent: true, status: 'ready' }).first('quoteId', 'path')) as { quoteId: number | string; path: string } | undefined
  return row ? { quoteId: Number(row.quoteId), path: row.path } : null
}
