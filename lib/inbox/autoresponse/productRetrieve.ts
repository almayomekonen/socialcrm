/**
 * Retrieve a small verified subset of SocialCRM capabilities for one IRE turn.
 * Empty unless the agency is allowlisted. Never dumps the full catalog.
 */
import {
  FOLLOW_UP_REMINDERS_ID,
  getCapability,
  INBOUND_AUTO_RESPONSE_ID,
  SOCIALCRM_CAPABILITIES,
  type ProductCapability,
} from '@/lib/product/capabilities'
import { type SalesMove, isExplanationRequest, isShortAffirmative } from './salesIntent'
import { isBusinessIdentityQuestion } from './businessIdentityIntent'

export const PRODUCT_KNOWLEDGE_ENV = 'IRE_PRODUCT_KNOWLEDGE_AGENCY_IDS'
const MAX_RETRIEVED = 3

export type ProductRetrieveResult = {
  enabled: boolean
  capabilities: ProductCapability[]
  unverifiedRequest: boolean
  closestAlternatives: ProductCapability[]
}

const WARMUP_RE =
  /חימום|הודעות יזומות|warm-?up|warmup|re-?engage|proactive (follow|message)|יזומות אחרי/i
const AUTO_REPLY_RE =
  /מענה אוטומטי|לענות אוטומט|תגיב|לא ליד המסך|לא ליד|auto[- ]?reply|auto-response|respond automatically/i

function parseAllowlist(raw: string | undefined): 'all' | number[] {
  const v = (raw ?? '').trim()
  if (!v) return []
  if (v === 'all') return 'all'
  return v
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
}

export function isProductKnowledgeEnabled(
  agencyId: number | null | undefined,
  envRaw: string | undefined = process.env[PRODUCT_KNOWLEDGE_ENV],
): boolean {
  if (!agencyId) return false
  const list = parseAllowlist(envRaw)
  if (list === 'all') return true
  return list.includes(agencyId)
}

function empty(enabled: boolean): ProductRetrieveResult {
  return { enabled, capabilities: [], unverifiedRequest: false, closestAlternatives: [] }
}

function cap(id: string): ProductCapability | undefined {
  return getCapability(id)
}

function scoreCapability(text: string, c: ProductCapability): number {
  const hay = text.toLowerCase()
  let score = 0
  for (const kw of c.whenRelevant) {
    if (kw && hay.includes(kw.toLowerCase())) score += 1
  }
  return score
}

const PRODUCT_MOVES: ReadonlySet<SalesMove> = new Set(['PRODUCT_QUESTION', 'PRODUCT_FIT', 'OBJECTION', 'BUYING_SIGNAL'])
const GENERAL_HELP_RE = /איך (אתה|אתם) יכול|מה המערכת עושה|how (can|could) you help/i

function wantsCatalogOverview(text: string, salesMove: SalesMove): boolean {
  if (salesMove === 'PRODUCT_FIT' || salesMove === 'BUYING_SIGNAL') return true
  if (salesMove !== 'PRODUCT_QUESTION') return false
  return (
    GENERAL_HELP_RE.test(text) ||
    isExplanationRequest(text) ||
    isShortAffirmative(text) ||
    isBusinessIdentityQuestion(text)
  )
}

/**
 * 0–3 verified capabilities for this inbound. Warm-up language is never treated
 * as inbound auto-response; it is unverified with closest alternatives.
 */
export function retrieveProductKnowledge(args: {
  agencyId: number
  inboundText: string
  salesMove: SalesMove
  envRaw?: string
}): ProductRetrieveResult {
  const enabled = isProductKnowledgeEnabled(args.agencyId, args.envRaw)
  if (!enabled) return empty(false)
  if (!PRODUCT_MOVES.has(args.salesMove)) return empty(true)

  const text = (args.inboundText ?? '').trim()
  if (!text) return empty(true)

  const warmup = WARMUP_RE.test(text)
  const autoReply = AUTO_REPLY_RE.test(text)
  if (warmup && !autoReply) {
    return {
      enabled: true,
      capabilities: [],
      unverifiedRequest: true,
      closestAlternatives: [cap(INBOUND_AUTO_RESPONSE_ID), cap(FOLLOW_UP_REMINDERS_ID)].filter(
        (c): c is ProductCapability => Boolean(c),
      ),
    }
  }

  const scored = SOCIALCRM_CAPABILITIES.map((c) => ({ c, score: scoreCapability(text, c) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RETRIEVED)
    .map((x) => x.c)

  if (warmup && autoReply) {
    const inbound = cap(INBOUND_AUTO_RESPONSE_ID)
    const rest = scored.filter((c) => c.id !== INBOUND_AUTO_RESPONSE_ID)
    return {
      enabled: true,
      capabilities: inbound ? [inbound, ...rest].slice(0, MAX_RETRIEVED) : rest.slice(0, MAX_RETRIEVED),
      unverifiedRequest: true,
      closestAlternatives: [],
    }
  }

  if (scored.length === 0) {
    if (wantsCatalogOverview(text, args.salesMove)) {
      const proactive = SOCIALCRM_CAPABILITIES.filter((c) => c.mayMentionProactively).slice(0, MAX_RETRIEVED)
      if (proactive.length) {
        return { enabled: true, capabilities: proactive, unverifiedRequest: false, closestAlternatives: [] }
      }
    }
    const closest = [cap(INBOUND_AUTO_RESPONSE_ID), cap(FOLLOW_UP_REMINDERS_ID)].filter(
      (c): c is ProductCapability => Boolean(c),
    )
    return { enabled: true, capabilities: [], unverifiedRequest: true, closestAlternatives: closest }
  }

  return { enabled: true, capabilities: scored, unverifiedRequest: false, closestAlternatives: [] }
}

export function formatProductKnowledgeBlock(result: ProductRetrieveResult): string | null {
  if (!result.enabled) return null
  const lines: string[] = ['עובדות מוצר מאומתות (מותר לצטט רק אותן; אסור להמציא):']
  if (result.unverifiedRequest) {
    lines.push(
      'הבקשה שתוארה אינה יכולת מאומתת בשמה. אל תמציא. אל תגיד שהמערכת שולחת הודעות חימום יזומות.',
    )
  }
  if (result.capabilities.length === 0 && result.closestAlternatives.length === 0) {
    lines.push('אין יכולת מאומתת רלוונטית. אל תמציא. אפשר להפנות לאדם אם צריך עובדה שאין כאן.')
    return lines.join('\n')
  }
  const explain = (c: ProductCapability, tag: string) =>
    `${tag} ${c.id}: ${c.safeExplanationHe} מגבלות: ${c.limitations.join(' ') || 'אין'}`
  for (const c of result.capabilities) lines.push(explain(c, 'מאומת:'))
  for (const c of result.closestAlternatives) {
    lines.push(`חלופה קרובה (רק אם מתאימה לכוונה, לא במקום הבקשה המקורית): ${explain(c, '')}`)
  }
  return lines.join('\n')
}
