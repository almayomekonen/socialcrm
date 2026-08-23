import { describe, expect, it } from 'vitest'
import {
  AGENT_MESSAGE_LIMIT_DEFAULT,
  AGENT_MESSAGE_LIMIT_MAX,
  agentConversationMessagesQuery,
  latestLeadConversationQuery,
} from '@/db/agentConversation'

/**
 * SQL-level construction tests for the Agent's bounded thread reader.
 *
 * The tool suite mocks this module, so nothing there can prove the window is
 * bounded at the DATABASE rather than sliced in memory — which is the whole
 * point of the reader existing. These assert the generated SQL: agency
 * isolation in the WHERE clause, a real LIMIT, and the clamp.
 *
 * Same approach as __tests__/today/facts.sql.test.ts — builders exported
 * separately from executors so they compile without a live database.
 */

const AGENCY = 123
const CONVERSATION = 991
const LEAD = 15015

const messagesSql = (limit?: number) =>
  agentConversationMessagesQuery({ agencyId: AGENCY, conversationId: CONVERSATION, limit }).toString().toLowerCase()

describe('agentConversationMessagesQuery — bounded at the database', () => {
  it('emits a real LIMIT, not an in-memory slice', () => {
    expect(messagesSql()).toMatch(/limit\s+\d+/)
  })

  it('defaults the window to the shared default', () => {
    expect(messagesSql()).toContain(`limit ${AGENT_MESSAGE_LIMIT_DEFAULT}`)
  })

  it('clamps a request above the maximum down to the ceiling', () => {
    expect(messagesSql(5_000)).toContain(`limit ${AGENT_MESSAGE_LIMIT_MAX}`)
  })

  it('clamps a non-positive request up to at least one row', () => {
    expect(messagesSql(0)).toContain('limit 1')
    expect(messagesSql(-10)).toContain('limit 1')
  })

  it('falls back to the default for a non-finite limit', () => {
    expect(messagesSql(Number.NaN)).toContain(`limit ${AGENT_MESSAGE_LIMIT_DEFAULT}`)
  })

  it('honours a limit inside the range verbatim', () => {
    expect(messagesSql(45)).toContain('limit 45')
  })

  it('is agency-isolated in the WHERE clause', () => {
    const s = messagesSql()
    expect(s).toMatch(/"agencyid"\s*=/)
    expect(s).toContain(String(AGENCY))
  })

  it('is scoped to the requested conversation', () => {
    const s = messagesSql()
    expect(s).toMatch(/"conversationid"\s*=/)
    expect(s).toContain(String(CONVERSATION))
  })

  it('takes the NEWEST messages (order by sequence desc)', () => {
    expect(messagesSql()).toMatch(/order by "sequence" desc/)
  })

  it('selects the fields the Agent needs and nothing more', () => {
    const s = messagesSql()
    for (const col of ['"id"', '"sequence"', '"direction"', '"text"', '"channeltimestamp"', '"createdat"']) {
      expect(s).toContain(col)
    }
  })

  it('does NOT select metadata — the AI/human discriminator is deliberately absent', () => {
    expect(messagesSql()).not.toContain('metadata')
  })
})

describe('latestLeadConversationQuery — agency-isolated resolution', () => {
  const sql = latestLeadConversationQuery({ agencyId: AGENCY, leadId: LEAD }).toString().toLowerCase()

  it('filters on agency, lead and the whatsapp channel', () => {
    expect(sql).toMatch(/"agencyid"\s*=/)
    expect(sql).toMatch(/"leadid"\s*=/)
    expect(sql).toContain('whatsapp')
    expect(sql).toContain(String(AGENCY))
    expect(sql).toContain(String(LEAD))
  })

  it('picks the most recently active thread', () => {
    expect(sql).toContain('"lastmessageat" desc nulls last')
  })

  it('reads a single row', () => {
    expect(sql).toContain('limit 1')
  })
})
