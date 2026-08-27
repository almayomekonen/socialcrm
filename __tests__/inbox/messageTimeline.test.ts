import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  HISTORY_SOURCE,
  historySourceMerge,
  messageOccurredAtSql,
  messageTimelineOrderSql,
  notHistorySql,
} from '@/lib/inbox/messageTimeline'
import { ECHO_SOURCE } from '@/lib/inbox/ingestWhatsappEcho'
import { AUTO_RESPONSE_SOURCE } from '@/lib/today/constants'
import { agentConversationMessagesQuery } from '@/db/agentConversation'
import { agencyLeadFactsQuery } from '@/db/ai/leadFacts'
import { candidateFactsQuery } from '@/db/today/facts'
import { promisedButWaitingQuery } from '@/db/briefing'
import { Roles } from '@/types/roles'

/**
 * Wave 2A.2a — the timeline foundation, before a single historical message
 * exists.
 *
 * WHAT THESE PROVE AND WHAT THEY DO NOT. Row ordering is executed by Postgres,
 * and proving it with real rows would mean running the DB harness, which applies
 * every migration — including this phase's, which must NOT be applied yet. So
 * ordering is proven where it is DECIDED: in the generated SQL and in the single
 * helper that generates it. This is the repo's established convention for
 * exactly this situation (see __tests__/today/facts.sql.test.ts).
 */

const SCOPE = { user: { role: Roles.ADMIN }, gotPermIds: [] }
const sqlOf = (q: { toString(): string }) => q.toString().toLowerCase()

/** Source with comments stripped — a doc comment mentioning a name is not a use. */
function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** The ORDER BY clause of a source file's reader, comments already stripped. */
function orderClauses(path: string): string {
  return codeOf(path)
    .split('\n')
    .filter((l) => /orderBy/.test(l))
    .join('\n')
}

describe('timeline key', () => {
  it('T1: chronology follows channelTimestamp, not sequence', () => {
    expect(messageOccurredAtSql('m')).toContain('"channelTimestamp"')
    expect(messageTimelineOrderSql('m')).not.toContain('sequence')
    expect(messageTimelineOrderSql('m').indexOf('"channelTimestamp"')).toBeLessThan(
      messageTimelineOrderSql('m').indexOf('"createdAt"'),
    )
  })

  it('T2: createdAt is the fallback when channelTimestamp is null', () => {
    // COALESCE with createdAt SECOND is what makes the fallback happen, and
    // createdAt is NOT NULL, so the key is total — no row can sort as null.
    expect(messageOccurredAtSql('m')).toBe(`COALESCE(m."channelTimestamp", m."createdAt")`)
  })

  it('T3: id breaks equal timestamps deterministically, in the same direction', () => {
    expect(messageTimelineOrderSql('m', 'asc')).toBe(
      `COALESCE(m."channelTimestamp", m."createdAt") ASC, m.id ASC`,
    )
    expect(messageTimelineOrderSql('m', 'desc')).toBe(
      `COALESCE(m."channelTimestamp", m."createdAt") DESC, m.id DESC`,
    )
  })

  it('T3b: the agent reader orders newest-first by occurrence with the id tiebreak', () => {
    const s = sqlOf(agentConversationMessagesQuery({ agencyId: 1, conversationId: 2 }))
    expect(s).toContain('coalesce(inbox_messages."channeltimestamp", inbox_messages."createdat") desc')
    expect(s).toContain('inbox_messages.id desc')
  })
})

describe('sequence is no longer chronological truth', () => {
  const READERS: [string, string][] = [
    ['db/inboxMessages.ts', 'thread readers'],
    ['db/conversationIntelligence.ts', 'AI analysis transcript'],
    ['db/agentConversation.ts', 'agent conversation read'],
  ]

  it.each(READERS)('T4: %s orders no chronological read by sequence', (path) => {
    expect(orderClauses(path)).not.toMatch(/sequence/)
  })

  it('T4b: but sequence is still SELECTED and still assigned MAX+1', () => {
    // The column keeps its meaning — order of arrival at us. Only the readers
    // that were asking a chronological question moved off it.
    const inbox = codeOf('db/inboxMessages.ts')
    expect(inbox).toContain(`.max<{ max: string | number | null }>('sequence as max')`)
    expect(inbox).toContain('const sequence = (Number(maxRow?.max) || 0) + 1')
    expect(codeOf('db/agentConversation.ts')).toContain("'sequence'")
  })
})

describe('live delta', () => {
  const delta = codeOf('db/inboxMessages.ts')
    .split('export async function getConversationMessagesAfter')[1]
    .split('export async function')[0]

  it('T5: historical messages are excluded from the delta', () => {
    expect(delta).toContain("notHistorySql('m')")
  })

  it('T6: live messages remain — the predicate is null-safe', () => {
    // Ordinary messages carry no metadata.source at all. `<>` against NULL
    // yields NULL, which would filter out the entire live inbox; IS DISTINCT
    // FROM yields true. This is the bug the assertion exists to prevent.
    expect(notHistorySql('m')).toContain('IS DISTINCT FROM')
    expect(notHistorySql('m')).not.toMatch(/<>|!=/)
  })

  it('T6b: the delta cursor is unchanged — still id-based', () => {
    expect(delta).toContain(`.andWhere('m.id', '>', afterId)`)
    expect(delta).toContain(`.orderBy('m.id', 'asc')`)
  })
})

describe('full thread render', () => {
  const full = codeOf('db/inboxMessages.ts')
    .split('export async function listConversationMessages')[1]
    .split('export async function')[0]

  it('T7: mixed historical + live renders chronologically — history is NOT excluded', () => {
    expect(full).toContain("messageTimelineOrderSql('m')")
    expect(full).not.toContain('notHistorySql')
  })

  it('T7b: the lead-page thread keeps conversation grouping, orders within by occurrence', () => {
    const lead = codeOf('db/inboxMessages.ts')
      .split('export async function listLeadWhatsappMessages')[1]
      .split('export async function')[0]
    expect(lead).toContain("`cv.id ASC, ${messageTimelineOrderSql('m')}`")
  })
})

describe('current-state protection', () => {
  it('T8: every current-state aggregation excludes history', () => {
    const P = `(m.metadata->>'source') is distinct from '${HISTORY_SOURCE}'`
    for (const s of [
      sqlOf(agencyLeadFactsQuery(123, 'pro')),
      sqlOf(candidateFactsQuery(123, 'pro', SCOPE)),
      sqlOf(promisedButWaitingQuery(123, 'pro', SCOPE)),
    ]) {
      expect(s).toContain(P)
      expect(s.match(new RegExp(P.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(2)
    }
  })

  it('T8b: the waiting-reply rule excludes history without disturbing auto_response', () => {
    const s = codeOf('lib/inbox/waitingReplySql.ts')
    expect(s).toContain("notHistorySql('m')")
    expect(s).toContain('${AUTO_RESPONSE_SOURCE}')
  })

  it('T8c: history exclusion did NOT replace the auto-response exclusion anywhere', () => {
    // Two independent markers, two independent reasons. Losing the
    // auto_response one silently makes an IRE reply count as a human answer.
    for (const s of [sqlOf(agencyLeadFactsQuery(123, 'pro')), sqlOf(candidateFactsQuery(123, 'pro', SCOPE))]) {
      expect(s).toContain(`is distinct from '${AUTO_RESPONSE_SOURCE}'`)
    }
  })
})

describe('signal / sequence compatibility', () => {
  it('T9: sequence-based signal references are untouched', () => {
    const facts = codeOf('db/ai/conversationFacts.ts')
    expect(facts).toContain('triggerSequence')
    // Signal code gained the history EXCLUSION but never the chronological
    // ORDERING: its questions are about arrival, and reordering them would
    // change detector semantics, which this phase must not do.
    expect(facts).not.toContain('messageTimelineOrderSql')
    expect(orderClauses('db/ai/conversationFacts.ts')).not.toContain('coalesce')
  })

  it('T9b: the stalled detector keeps sequence semantics AND excludes history', () => {
    // The ONE detector that reads raw inbox_messages for a current-state
    // question. Arrival-ordered on purpose; history excluded because that is
    // exactly what makes arrival-ordering unsafe once an archive lands.
    const stalled = codeOf('db/ai/conversationFacts.ts')
      .split('export function agencyStalledConversationsQuery')[1]
      .split('export ')[0]
    expect(stalled).toContain('m.sequence > t."triggerSequence"')
    expect(stalled).toContain("notHistorySql('m')")
  })

  it('T10: triggerSequence comparison and coveredSequence still use sequence', () => {
    expect(codeOf('db/ai/conversationFacts.ts')).toMatch(/m\."?sequence"?\s*>/)
    expect(codeOf('db/conversationIntelligence.ts')).toContain(`max<{ max: string | number | null }>('sequence as max')`)
  })
})

describe('markers', () => {
  it('T11: the history marker is exactly whatsapp_history', () => {
    expect(HISTORY_SOURCE).toBe('whatsapp_history')
    expect(historySourceMerge()).toEqual({
      sql: 'metadata || ?::jsonb',
      bindings: ['{"source":"whatsapp_history"}'],
    })
  })

  it('T12: it is distinct from the echo and auto-response markers', () => {
    expect(ECHO_SOURCE).toBe('smb_message_echo')
    expect(new Set([HISTORY_SOURCE, ECHO_SOURCE, AUTO_RESPONSE_SOURCE]).size).toBe(3)
  })

  it('T12b: the literal is not scattered — one definition, referenced by helper', () => {
    for (const p of ['db/ai/leadFacts.ts', 'db/today/facts.ts', 'db/briefing.ts', 'lib/inbox/waitingReplySql.ts', 'db/inboxMessages.ts']) {
      expect(codeOf(p)).not.toContain("'whatsapp_history'")
      expect(codeOf(p)).toContain('notHistorySql')
    }
  })
})

describe('scope guard', () => {
  const migration = readFileSync('migrations/20260826000006_inbox_messages_timeline_index.cjs', 'utf8')

  it('T13: the migration is additive, reversible, and not applied by this suite', () => {
    expect(migration).toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS inbox_messages_conv_timeline_idx')
    expect(migration).toContain('DROP INDEX CONCURRENTLY IF EXISTS inbox_messages_conv_timeline_idx')
    // CONCURRENTLY cannot run inside a transaction.
    expect(migration).toContain('exports.config = { transaction: false }')
    // Nothing destructive, and no data touched.
    expect(migration).not.toMatch(/ALTER TABLE|DROP TABLE|DROP COLUMN|UPDATE |DELETE |TRUNCATE/)
    // This file runs under VITEST_NO_DB=1, which skips schema reset + migrations.
    expect(process.env.VITEST_NO_DB).toBe('1')
  })

  it('T13b: sequence keeps its type, constraints and unique index', () => {
    // Stripped of comments: the doc explains why sequence is untouched, and a
    // mention is not a DDL statement.
    const ddl = codeOf('migrations/20260826000006_inbox_messages_timeline_index.cjs')
    expect(ddl).not.toContain('sequence')
    expect(ddl).not.toContain('inbox_messages_conv_seq_uniq')
    expect(ddl).not.toContain('inbox_messages_channel_external_uniq')
  })

  it('T14: no history importer, no history jobs, no history enablement', () => {
    expect(existsSync('lib/inbox/ingestWhatsappHistory.ts')).toBe(false)
    expect(codeOf('lib/whatsapp/coexistence.ts')).toContain('export const HISTORY_SYNC_ENABLED = false')
    expect(existsSync('migrations/20260826000007_create_history_jobs.cjs')).toBe(false)
    // The marker exists; nothing writes it yet. `historySourceMerge` is the
    // single writer Wave 2A.2c will call, and today it has no callers.
    expect(codeOf('lib/inbox/messageTimeline.ts')).toContain('historySourceMerge')
  })
})
