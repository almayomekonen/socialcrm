import { GRAPH_BASE } from '@/lib/facebook/graph'
import type { MetaComponent, TemplateCategory } from './types'

/**
 * Graph API client for message templates — the ONLY place that talks to Meta for
 * templates. Thin transport, mirroring `lib/whatsapp/sendMessage.ts`: structured
 * success/failure, never throws across the boundary, logs fbtrace server-side.
 *
 * Sprint 3 implements CREATE only. (list → Sprint 4 reconcile, delete → Sprint 5
 * discard — added when those sprints consume them.)
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
