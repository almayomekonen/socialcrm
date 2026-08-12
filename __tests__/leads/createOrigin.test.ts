/**
 * clients.createOrigin — durable create-path origin (Option 1).
 * Prefer VITEST_NO_DB=1; optional live CHECK when DB is available.
 */

import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CLIENT_CREATE_ORIGINS,
  createOriginForUpsert,
  isClientCreateOrigin,
} from '@/lib/leads/createOrigin'

describe('createOrigin vocabulary', () => {
  it('accepts only the approved origins', () => {
    for (const o of CLIENT_CREATE_ORIGINS) expect(isClientCreateOrigin(o)).toBe(true)
    expect(isClientCreateOrigin('webhook')).toBe(false)
    expect(isClientCreateOrigin('webhook_facebook')).toBe(false)
    expect(isClientCreateOrigin(null)).toBe(false)
  })

  it('maps upsert emit origins: import → import, else → manual', () => {
    expect(createOriginForUpsert('import')).toBe('import')
    expect(createOriginForUpsert('manual')).toBe('manual')
  })
})

describe('migration — additive createOrigin CHECK', () => {
  const migrationPath = path.join(process.cwd(), 'migrations/20260812100001_clients_create_origin.cjs')

  it('exists and is additive text+CHECK (not ENUM, no leadSource backfill)', () => {
    expect(fs.existsSync(migrationPath)).toBe(true)
    const body = fs.readFileSync(migrationPath, 'utf8')
    expect(body).toContain('ADD COLUMN IF NOT EXISTS "createOrigin" text')
    expect(body).toMatch(/"createOrigin" IS NULL/)
    for (const o of CLIENT_CREATE_ORIGINS) expect(body).toContain(`'${o}'`)
    expect(body).not.toMatch(/CREATE\s+TYPE/i)
    expect(body.toLowerCase()).not.toContain('backfill')
    expect(body).not.toMatch(/UPDATE\s+clients\s+SET\s+"createOrigin"/i)
    expect(body).not.toMatch(/leadSource/)
  })

  it('leaves legacy rows NULL (nullable CHECK; no UPDATE backfill)', () => {
    const body = fs.readFileSync(migrationPath, 'utf8')
    expect(body).toMatch(/"createOrigin" IS NULL/)
    expect(body).not.toMatch(/NOT NULL/)
    expect(body).not.toMatch(/DEFAULT\s+'/i)
  })
})

describe('product writers set createOrigin (source contract)', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

  it('upsertLead INSERT uses createOriginForUpsert / createOrigin on insert', () => {
    const src = read('actions/clients.ts')
    expect(src).toContain('createOriginForUpsert')
    expect(src).toMatch(/createOrigin:\s*createOriginForUpsert\(emitOrigin\)/)
    expect(src).not.toContain("'createOrigin'") // not in CLIENT_WRITABLE string list as writable key - check set
    expect(src).toMatch(/CLIENT_WRITABLE_LEAD_FIELDS[\s\S]*?\]/)
    const allow = src.slice(src.indexOf('CLIENT_WRITABLE_LEAD_FIELDS'), src.indexOf('function pickLeadFields'))
    expect(allow).not.toContain('createOrigin')
  })

  it('addLeads forces createOrigin import', () => {
    const src = read('actions/clients.ts')
    expect(src).toMatch(/addLeads[\s\S]*?createOrigin:\s*'import'/)
  })

  it('upsertLead UPDATE strips createOrigin (immutable)', () => {
    const src = read('actions/clients.ts')
    expect(src).toMatch(/delete\s+\(safeData as.*\)\.createOrigin|delete safeData\.createOrigin/)
  })

  it('Facebook / WhatsApp / CF7 pass their origins into insertLeadSystem', () => {
    expect(read('lib/system/createClientFromWebhook.ts')).toMatch(/createOrigin:\s*'facebook'/)
    expect(read('lib/system/createLeadFromWhatsappWebhook.ts')).toMatch(/createOrigin:\s*'whatsapp'/)
    expect(read('lib/automations/connectors/contactForm7.ts')).toMatch(/createOrigin:\s*'cf7'/)
  })

  it('insertLeadSystem persists input.createOrigin', () => {
    const src = read('lib/system/insertLeadSystem.ts')
    expect(src).toContain('createOrigin: ClientCreateOrigin')
    expect(src).toMatch(/createOrigin:\s*input\.createOrigin/)
  })
})

// ── insertLeadSystem runtime ─────────────────────────────────────────────

let lastInsert: Record<string, unknown> | null = null

vi.mock('@/config/db', () => ({
  db: (table: string) => {
    if (table !== 'clients') throw new Error(`unexpected table ${table}`)
    return {
      insert: (row: Record<string, unknown>) => {
        lastInsert = row
        return {
          returning: async () => [{ id: 99, ...row }],
        }
      },
    }
  },
}))

const { insertLeadSystem } = await import('@/lib/system/insertLeadSystem')

describe('insertLeadSystem runtime', () => {
  beforeEach(() => {
    lastInsert = null
  })

  it('writes createOrigin facebook on insert', async () => {
    await insertLeadSystem({
      agencyId: 7,
      userId: 3,
      firstName: 'A',
      idNum: null,
      leadSource: 'facebook:1',
      overQuota: false,
      createOrigin: 'facebook',
    })
    expect(lastInsert).toMatchObject({ createOrigin: 'facebook' })
  })

  it('writes createOrigin whatsapp / cf7', async () => {
    await insertLeadSystem({
      agencyId: 7,
      userId: 3,
      firstName: 'A',
      idNum: null,
      leadSource: 'whatsapp:1',
      overQuota: false,
      createOrigin: 'whatsapp',
    })
    expect(lastInsert?.createOrigin).toBe('whatsapp')

    await insertLeadSystem({
      agencyId: 7,
      userId: 3,
      firstName: 'A',
      idNum: null,
      leadSource: 'contact_form_7:1:s',
      overQuota: false,
      createOrigin: 'cf7',
    })
    expect(lastInsert?.createOrigin).toBe('cf7')
  })

  it('writes createOrigin import / manual when callers pass them', async () => {
    await insertLeadSystem({
      agencyId: 7,
      userId: 3,
      firstName: 'A',
      idNum: null,
      leadSource: null,
      overQuota: false,
      createOrigin: 'import',
    })
    expect(lastInsert?.createOrigin).toBe('import')

    await insertLeadSystem({
      agencyId: 7,
      userId: 3,
      firstName: 'B',
      idNum: null,
      leadSource: null,
      overQuota: false,
      createOrigin: 'manual',
    })
    expect(lastInsert?.createOrigin).toBe('manual')
  })
})

describe('CSV import path uses upsertLead origin import', () => {
  it('importLeadsFromCsv calls upsertLead with import origin', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'actions/clients.ts'), 'utf8')
    expect(src).toMatch(/upsertLead\([\s\S]*?,\s*'import'\)/)
  })
})
