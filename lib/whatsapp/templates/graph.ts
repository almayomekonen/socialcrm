import { GRAPH_BASE } from '@/lib/facebook/graph'
import type { MetaComponent, TemplateCategory } from './types'

/**
 * Graph API client for message templates — the ONLY place that talks to Meta for
 * templates. Thin transport, mirroring `lib/whatsapp/sendMessage.ts`: structured
 * success/failure, never throws across the boundary, logs fbtrace server-side.
 *
 * Sprint 3 implements CREATE; Sprint 4 adds LIST (reconcile); Sprint 5 adds
 * DELETE (discard).
 *
 * Every Graph error is mapped to a user-facing Hebrew string HERE, so the raw
 * Meta code/message never travels past this client to the action or the UI.
 */

export type CreateTemplateArgs = {
  wabaId: string
  accessToken: string
  name: string
  language: string
  category: TemplateCategory
  components: MetaComponent[]
}

export type CreateTemplateResult =
  | { ok: true; metaTemplateId: string; status: string }
  | { ok: false; error: string; code?: string; httpStatus?: number }

const CREATE_ERROR_COPY = {
  auth: 'יש בעיה בחיבור הוואטסאפ. ייתכן שצריך לחבר מחדש.',
  rate_limit: 'הגעתם למכסת ההודעות היומית של וואטסאפ. נסו שוב מחר.',
  invalid: 'לא ניתן ליצור את ההודעה בנוסח הזה. כדאי לפשט ולנסות שוב.',
  generic: 'משהו השתבש ביצירת ההודעה. נסו שוב.',
} as const

/** Meta create error → Hebrew. Exported for testing; raw code stays server-side. */
export function mapCreateError(code: number | undefined, httpStatus: number): string {
  if (httpStatus === 401 || code === 190) return CREATE_ERROR_COPY.auth
  if (httpStatus === 429 || code === 4 || code === 80007 || code === 130429) return CREATE_ERROR_COPY.rate_limit
  if (httpStatus === 400 || code === 100) return CREATE_ERROR_COPY.invalid
  return CREATE_ERROR_COPY.generic
}

export type MetaTemplate = {
  id: string
  name: string
  language: string
  status: string
  category: string
  components?: unknown[]
  rejected_reason?: string
  quality_score?: { score?: string }
}

export type ListTemplatesResult = { ok: true; templates: MetaTemplate[] } | { ok: false }

/**
 * List all templates on a WABA (reconcile source of truth). Cursor-paginated;
 * capped at a sane page count so a huge account cannot run the cron away. Returns
 * `{ ok: false }` on any Graph error — the reconciler simply skips that WABA.
 */
export async function listTemplatesFromMeta(wabaId: string, accessToken: string): Promise<ListTemplatesResult> {
  const fields = 'id,name,language,status,category,components,rejected_reason,quality_score'
  const templates: MetaTemplate[] = []
  let url: string | null = `${GRAPH_BASE}/${wabaId}/message_templates?fields=${fields}&limit=100`
  let pages = 0
  try {
    while (url && pages < 20) {
      const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!res.ok) {
        console.error('[templates.graph.list] error', { wabaId, httpStatus: res.status })
        return { ok: false }
      }
      const data = (await res.json()) as { data?: MetaTemplate[]; paging?: { next?: string } }
      for (const t of data.data ?? []) templates.push(t)
      url = data.paging?.next ?? null
      pages++
    }
    return { ok: true, templates }
  } catch (err) {
    console.error('[templates.graph.list] fetch failed', { wabaId, error: String(err) })
    return { ok: false }
  }
}

export type DeleteTemplateResult = { ok: true } | { ok: false; error: string }

const DELETE_ERROR = 'לא ניתן להסיר את ההודעה כרגע. נסו שוב.'

/** Delete a template by name from a WABA (discard path). Errors mapped to Hebrew. */
export async function deleteTemplateOnMeta(wabaId: string, accessToken: string, name: string): Promise<DeleteTemplateResult> {
  try {
    const res = await fetch(`${GRAPH_BASE}/${wabaId}/message_templates?name=${encodeURIComponent(name)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: { code?: number; message?: string } }
      console.error('[templates.graph.delete] error', { wabaId, httpStatus: res.status, code: data.error?.code })
      return { ok: false, error: DELETE_ERROR }
    }
    return { ok: true }
  } catch (err) {
    console.error('[templates.graph.delete] fetch failed', { wabaId, error: String(err) })
    return { ok: false, error: DELETE_ERROR }
  }
}

export type EditTemplateResult = { ok: true } | { ok: false; error: string; code?: string; httpStatus?: number }

const EDIT_ERROR_COPY = {
  auth: 'יש בעיה בחיבור הוואטסאפ. ייתכן שצריך לחבר מחדש.',
  edit_limit: 'ההודעה כבר נערכה לאחרונה. אפשר לערוך אותה שוב מאוחר יותר.',
  invalid: 'לא ניתן לשמור את הנוסח הזה. כדאי לפשט ולנסות שוב.',
  generic: 'משהו השתבש בשמירת ההודעה. נסו שוב.',
} as const

/** Meta edit error → Hebrew. Exported for testing; raw code stays server-side. */
export function mapEditError(code: number | undefined, httpStatus: number): string {
  if (httpStatus === 401 || code === 190) return EDIT_ERROR_COPY.auth
  // Edit-frequency limit (10/30d, 1/24h) surfaces as a rate/limit error.
  if (httpStatus === 429 || code === 4 || code === 80007 || code === 130429 || code === 131048) return EDIT_ERROR_COPY.edit_limit
  if (httpStatus === 400 || code === 100) return EDIT_ERROR_COPY.invalid
  return EDIT_ERROR_COPY.generic
}

/**
 * Edit an existing template in place (RFC R-B hybrid amendment, MVP safe path).
 * Meta v23: `POST /{template_id}` replaces the components. We send ONLY `components`
 * — never name/language (immutable identity) and never category (unchanged in the
 * safe path; Meta forbids category edits on approved templates anyway). Structured
 * result, never throws across the boundary; raw Meta code stays server-side.
 */
export async function editTemplateOnMeta(
  metaTemplateId: string,
  accessToken: string,
  args: { components: MetaComponent[] },
): Promise<EditTemplateResult> {
  try {
    const res = await fetch(`${GRAPH_BASE}/${metaTemplateId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ components: args.components }),
    })
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean
      error?: { code?: number; error_subcode?: number; message?: string; fbtrace_id?: string }
    }
    if (!res.ok) {
      const err = data.error ?? {}
      console.error('[templates.graph.edit] error', {
        httpStatus: res.status,
        code: err.code,
        subcode: err.error_subcode,
        fbtrace_id: err.fbtrace_id,
        message: err.message,
      })
      return {
        ok: false,
        error: mapEditError(err.code, res.status),
        code: err.code != null ? String(err.code) : undefined,
        httpStatus: res.status,
      }
    }
    return { ok: true }
  } catch (err) {
    console.error('[templates.graph.edit] fetch failed', err)
    return { ok: false, error: EDIT_ERROR_COPY.generic }
  }
}

export async function createTemplateOnMeta(args: CreateTemplateArgs): Promise<CreateTemplateResult> {
  const { wabaId, accessToken, name, language, category, components } = args
  try {
    const res = await fetch(`${GRAPH_BASE}/${wabaId}/message_templates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, language, category, components }),
    })
    const data = (await res.json().catch(() => ({}))) as {
      id?: string
      status?: string
      error?: { code?: number; error_subcode?: number; message?: string; fbtrace_id?: string }
    }

    if (!res.ok) {
      const err = data.error ?? {}
      console.error('[templates.graph.create] error', {
        httpStatus: res.status,
        code: err.code,
        subcode: err.error_subcode,
        fbtrace_id: err.fbtrace_id,
        message: err.message,
      })
      return {
        ok: false,
        error: mapCreateError(err.code, res.status),
        code: err.code != null ? String(err.code) : undefined,
        httpStatus: res.status,
      }
    }

    if (!data.id) {
      console.error('[templates.graph.create] missing id in response', data)
      return { ok: false, error: CREATE_ERROR_COPY.generic }
    }
    return { ok: true, metaTemplateId: String(data.id), status: String(data.status ?? 'PENDING') }
  } catch (err) {
    console.error('[templates.graph.create] fetch failed', err)
    return { ok: false, error: CREATE_ERROR_COPY.generic }
  }
}
