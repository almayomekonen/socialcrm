import 'server-only'
import { db } from '@/config/db'
import { isAdmin } from '@/types/roles'
import type { AgentScope, EvidenceRef } from '@/lib/agent/types'
import { redactContactDetails } from './render'

/**
 * WHICH LEAD a meeting, task or follow-up is for — never guessed.
 *
 * The candidates are the leads the Agent read in this turn plus the one it
 * proposed, limited to what THIS user may act on (agency + rep visibility, the
 * bound every executor enforces). Of those, the ones the owner actually named
 * count; then:
 *   - one → that lead;
 *   - several → the owner's full name narrows it, or their answer to our
 *     question ("2", "השני", or the phone's last digits); otherwise ONE
 *     question listing each with its phone's last four digits;
 *   - none readable → refused.
 */

export type LeadOption = { id: number; name: string; first: string; phoneTail: string | null }
export type LeadChoice = { lead: LeadOption } | { ask: string } | { refused: true }

const MAX_LISTED = 5
const ORDINALS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי']
const norm = (s: string) => s.toLocaleLowerCase().replace(/\s+/g, ' ').trim()
const hasWord = (text: string, w: string) =>
  !!w && new RegExp(`(?:^|[^\\p{L}])[ולבשמה]?${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'u').test(text)

async function readable(scope: AgentScope, ids: number[]): Promise<LeadOption[]> {
  if (!ids.length) return []
  const q = db('clients').where({ agencyId: scope.agencyId }).whereIn('id', ids).orderBy('id')
  if (!isAdmin(scope.role)) q.whereIn('userId', scope.gotPermIds ?? [])
  const rows = (await q.select('id', 'firstName', 'lastName', 'phone')) as {
    id: number
    firstName: string | null
    lastName: string | null
    phone: string | null
  }[]
  return rows.map((r) => {
    const digits = (r.phone ?? '').replace(/\D/g, '')
    return {
      id: Number(r.id),
      name: [r.firstName, r.lastName].filter(Boolean).join(' '),
      first: r.firstName ?? '',
      phoneTail: digits.length >= 4 ? digits.slice(-4) : null,
    }
  })
}

/** "2" / "השני" / "1234" — the owner's answer to our list, from their newest message only. */
function selected(options: readonly LeadOption[], reply: string): LeadOption | null {
  const text = norm(reply)
  const digits = [...text.matchAll(/(?<!\d)(\d{3,4})(?!\d)/g)].map((m) => m[1])
  const byPhone = options.filter((o) => o.phoneTail && digits.some((d) => o.phoneTail!.endsWith(d)))
  if (byPhone.length === 1) return byPhone[0]
  if (text.split(' ').length > 3 || /יום/u.test(text)) return null
  const m = /^(?:מספר\s+)?(?:את\s+)?[הל]?(ראשון|שני|שלישי|רביעי|חמישי|[1-5])(?:\s|$|[.!])/u.exec(text)
  if (!m) return null
  const i = /\d/.test(m[1]) ? Number(m[1]) - 1 : ORDINALS.indexOf(m[1])
  return options[i] ?? null
}

export function whichLeadQuestion(options: readonly LeadOption[]): string {
  const shown = options.slice(0, MAX_LISTED)
  const same = shown.every((o) => norm(o.name) === norm(shown[0].name))
  const label = (o: LeadOption) => redactContactDetails(o.name).trim() || 'ליד'
  const head = same ? `יש ${options.length} לידים בשם ${label(shown[0])}:` : 'יש כמה לידים מתאימים:'
  const lines = shown.map((o, i) => `${i + 1}. ${label(o)}${o.phoneTail ? `, טלפון שמסתיים ב-${o.phoneTail}` : ''}`)
  return [head, ...lines, 'איזה מהם?'].join('\n')
}

export async function chooseLead(input: {
  scope: AgentScope
  proposedId: number
  evidence: readonly EvidenceRef[]
  /** The owner's request, newest message first. */
  said: readonly string[]
}): Promise<LeadChoice> {
  const seen = input.evidence.filter((e) => e.kind === 'lead').map((e) => Number(e.refId))
  const ids = [...new Set([...seen, input.proposedId])].filter((n) => Number.isSafeInteger(n) && n > 0)
  const options = await readable(input.scope, ids)
  if (!options.length) return { refused: true }

  const said = norm(input.said.join(' '))
  const named = options.filter((o) => (o.name.includes(' ') && said.includes(norm(o.name))) || hasWord(said, norm(o.first)))
  const pool = named.length ? named : options
  if (pool.length === 1) {
    // Without a name match, the only candidate must be the one proposed.
    return named.length || pool[0].id === input.proposedId ? { lead: pool[0] } : { refused: true }
  }
  const full = pool.filter((o) => o.name.includes(' ') && said.includes(norm(o.name)))
  if (full.length === 1 && pool.filter((o) => norm(o.name) === norm(full[0].name)).length === 1) return { lead: full[0] }
  if (input.said.length > 1) {
    const pick = selected(pool, input.said[0])
    if (pick) return { lead: pick }
  }
  return { ask: whichLeadQuestion(pool) }
}
