import { describe, it, expect, afterAll } from 'vitest'
import { db } from '@/config/db'

/**
 * ChatGPT / MCP Phase A schema: four additive tables, no FK into existing
 * tables. Column lists are asserted exactly so a later migration cannot quietly
 * widen what the OAuth server stores (hashes only, never raw credentials).
 */

async function columns(table: string): Promise<string[]> {
  const rows = await db('information_schema.columns').where({ table_schema: 'public', table_name: table }).select('column_name')
  return rows.map((r: { column_name: string }) => r.column_name).sort()
}

async function indexDefs(table: string): Promise<string> {
  const res = await db.raw(`SELECT indexdef FROM pg_indexes WHERE tablename = ?`, [table])
  return res.rows.map((r: { indexdef: string }) => r.indexdef).join('\n')
}

describe('ChatGPT MCP schema', () => {
  afterAll(async () => {
    await db.destroy()
  })

  it('creates oauth_grants', async () => {
    expect(await columns('oauth_grants')).toEqual([
      'agency_id',
      'client_id',
      'client_name',
      'created_at',
      'id',
      'last_used_at',
      'resource',
      'revoked_at',
      'revoked_reason',
      'scopes',
      'session_version',
      'user_id',
    ])
  })

  it('creates oauth_authorization_codes with a unique request_jti (single-use pending request)', async () => {
    expect(await columns('oauth_authorization_codes')).toEqual([
      'client_id',
      'code_challenge',
      'code_hash',
      'consumed_at',
      'created_at',
      'expires_at',
      'grant_id',
      'id',
      'redirect_uri',
      'request_jti',
      'resource',
      'scopes',
    ])
    expect(await indexDefs('oauth_authorization_codes')).toMatch(/UNIQUE.*request_jti/)
  })

  it('creates oauth_refresh_tokens', async () => {
    expect(await columns('oauth_refresh_tokens')).toEqual([
      'expires_at',
      'family_id',
      'grant_id',
      'id',
      'issued_at',
      'revoked_at',
      'revoked_reason',
      'scopes',
      'token_hash',
      'used_at',
      'user_id',
    ])
  })

  it('creates mcp_audit_events with a kind CHECK', async () => {
    expect(await columns('mcp_audit_events')).toEqual([
      'agency_id',
      'client_id',
      'duration_ms',
      'grant_id',
      'id',
      'kind',
      'occurred_at',
      'outcome',
      'params',
      'request_id',
      'result_count',
      'source',
      'target_id',
      'target_type',
      'tool',
      'user_id',
    ])
    const [g] = await db('oauth_grants')
      .insert({
        user_id: 1,
        agency_id: 1,
        client_id: 'https://chatgpt.com/oauth/client.json',
        client_name: 'ChatGPT',
        resource: 'https://crm.test/api/mcp',
        scopes: ['crm.leads.read'],
        session_version: 0,
      })
      .returning('id')
    await expect(
      db('mcp_audit_events').insert({
        request_id: '00000000-0000-0000-0000-000000000000',
        agency_id: 1,
        user_id: 1,
        grant_id: g.id,
        client_id: 'https://chatgpt.com/oauth/client.json',
        tool: 'search_leads',
        kind: 'delete',
        outcome: 'ok',
      }),
    ).rejects.toThrow(/mcp_audit_events_kind_check/)
  })

  it('allows only one ACTIVE grant per (user, client, resource)', async () => {
    const base = {
      user_id: 2,
      agency_id: 1,
      client_id: 'https://chatgpt.com/oauth/client.json',
      client_name: 'ChatGPT',
      resource: 'https://crm.test/api/mcp',
      scopes: ['crm.leads.read'],
      session_version: 0,
    }
    await db('oauth_grants').insert(base)
    await expect(db('oauth_grants').insert(base)).rejects.toThrow(/duplicate key/)
    await db('oauth_grants').where({ user_id: 2 }).update({ revoked_at: db.fn.now() })
    await expect(db('oauth_grants').insert(base)).resolves.toBeDefined()
  })

  it('stores only hashes: no raw code or token columns exist', async () => {
    for (const t of ['oauth_authorization_codes', 'oauth_refresh_tokens']) {
      const cols = await columns(t)
      expect(cols).not.toContain('code')
      expect(cols).not.toContain('token')
      expect(cols).not.toContain('refresh_token')
    }
  })
})
