import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import {
  assertSandboxProbeEnvironment,
  SandboxProbeRefusal,
  type ProbeGuardInput,
} from '@/scripts/lib/growSandboxProbeGuard'
import { redactKnownSecrets, sanitizeGrowEvidence } from '@/scripts/lib/sanitizeGrowEvidence'

const good = (): ProbeGuardInput => ({
  envFileExists: true,
  envFileIgnoredByGit: true,
  stateDirIgnoredByGit: true,
  envFileVars: { GROW_MODE: 'sandbox', GROW_USER_ID: 'sandbox-user', GROW_PAGE_CODE_TOKEN: 'sandbox-page' },
  processEnv: { NODE_ENV: 'development', PATH: '/usr/bin' },
})

function refusal(input: ProbeGuardInput): string {
  try {
    assertSandboxProbeEnvironment(input)
  } catch (err) {
    expect(err).toBeInstanceOf(SandboxProbeRefusal)
    return (err as SandboxProbeRefusal).reason
  }
  throw new Error('expected a refusal')
}

describe('assertSandboxProbeEnvironment — fails closed', () => {
  it('returns the identifiers from the designated file when everything is in order', () => {
    expect(assertSandboxProbeEnvironment(good())).toEqual({ userId: 'sandbox-user', tokenPageCode: 'sandbox-page' })
  })

  it('refuses without the designated sandbox file', () => {
    expect(refusal({ ...good(), envFileExists: false })).toBe('sandbox_env_file_missing')
  })

  it('refuses a sandbox file git would commit', () => {
    expect(refusal({ ...good(), envFileIgnoredByGit: false })).toBe('sandbox_env_file_not_gitignored')
  })

  it('refuses when the evidence/state directory is not gitignored (it stores sandbox tokens)', () => {
    expect(refusal({ ...good(), stateDirIgnoredByGit: false })).toBe('state_dir_not_gitignored')
  })

  it.each([
    [{ VERCEL: '1' }],
    [{ VERCEL_ENV: 'preview' }],
    [{ NEXT_PUBLIC_VERCEL_ENV: 'production' }],
    [{ APP_ENV: 'production' }],
    [{ NODE_ENV: 'production' }],
  ])('refuses a deployed or production runtime: %o', (extra) => {
    expect(refusal({ ...good(), processEnv: { ...good().processEnv, ...extra } })).toBe('refuses_deployed_or_production_runtime')
  })

  it('refuses a file that is not in sandbox mode', () => {
    expect(refusal({ ...good(), envFileVars: { ...good().envFileVars, GROW_MODE: 'production' } })).toBe('sandbox_env_file_mode_not_sandbox')
  })

  it('refuses a file carrying anything beyond the three Grow sandbox keys (e.g. database access)', () => {
    const r = () => refusal({ ...good(), envFileVars: { ...good().envFileVars, DATABASE_URL: 'x' } })
    expect(r()).toBe('sandbox_env_file_unexpected_keys')
  })

  it('refuses missing identifiers', () => {
    expect(refusal({ ...good(), envFileVars: { GROW_MODE: 'sandbox', GROW_USER_ID: '', GROW_PAGE_CODE_TOKEN: 'p' } })).toBe(
      'sandbox_identifiers_missing',
    )
  })

  it('refuses Grow variables already present in the shell: identifiers come only from the designated file', () => {
    expect(refusal({ ...good(), processEnv: { ...good().processEnv, GROW_USER_ID: 'other' } })).toBe('grow_variables_already_in_environment')
    expect(refusal({ ...good(), processEnv: { ...good().processEnv, GROW_MODE: 'production' } })).toBe('grow_variables_already_in_environment')
  })

  it('never puts a value in the refusal message', () => {
    try {
      assertSandboxProbeEnvironment({ ...good(), envFileVars: { ...good().envFileVars, SECRET_THING: 'super-secret-value' } })
    } catch (err) {
      expect(String((err as Error).message)).not.toContain('super-secret-value')
      expect(String((err as Error).message)).toContain('SECRET_THING')
    }
  })
})

describe('sanitizeGrowEvidence', () => {
  it('keeps the facts Gate B needs and masks everything sensitive', () => {
    const out = sanitizeGrowEvidence({
      status: 1,
      err: '',
      data: {
        statusCode: '11',
        status: 'עסקה מושהית',
        sum: '1',
        processId: '462950',
        url: 'https://sandbox.meshulam.co.il/s/abc?token=secret-in-url',
        cardExp: '1125',
        cardSuffix: '1234',
        cardToken: '9294decf1dg5g2g5g2g5g2g58fd286',
        transactionToken: '4e6ca0b42e5ca8f35563cg2g517ed5e',
        processToken: 'e2202e3c9ffaaf65de1g2g53fbad5e9d',
        fullName: 'בדיקה GROW',
        payerPhone: '0500000000',
        payerEmail: 'a@b.com',
        payerBankAccountDetails: { bankNum: '10', accountNum: '1234567', accountName: 'name name' },
      },
    }) as { data: Record<string, unknown> }
    expect(out.data).toMatchObject({ statusCode: '11', status: 'עסקה מושהית', sum: '1', processId: '462950', cardExp: 'NNNN', cardSuffix: 'NNNN' })
    for (const k of ['cardToken', 'transactionToken', 'processToken', 'fullName', 'payerPhone', 'payerEmail', 'url']) {
      expect(String(out.data[k])).toMatch(/^<redacted len \d+>$/)
    }
    expect(JSON.stringify(out)).not.toMatch(/9294decf|4e6ca0b4|e2202e3c|0500000000|a@b\.com|1234567|secret-in-url/)
  })

  it('masks values under keys it does not know, keeping only the key names (undocumented responses)', () => {
    const out = sanitizeGrowEvidence({
      status: 1,
      data: { items: [{ statusCode: '2', payerIdNumber: '123456789', cardOwnerSocialId: '987654321', weirdNewField: 'x@y.z' }], total: 7 },
    }) as { data: { items: Record<string, unknown>[]; total: unknown } }
    expect(Object.keys(out.data.items[0])).toEqual(['statusCode', 'payerIdNumber', 'cardOwnerSocialId', 'weirdNewField'])
    expect(out.data.items[0].statusCode).toBe('2')
    expect(out.data.total).toBe('<redacted len 1>')
    expect(JSON.stringify(out)).not.toMatch(/123456789|987654321|x@y\.z/)
  })

  it('removes known secret values even from fields it keeps (e.g. an error that echoes the pageCode)', () => {
    const secrets = ['sandbox-page-code-123', 'user-id-4567', 'card-token-abcdef']
    const out = sanitizeGrowEvidence({ status: 0, err: { id: 54, message: 'pageCode sandbox-page-code-123 invalid for user-id-4567' }, data: '' }, secrets)
    expect(JSON.stringify(out)).not.toMatch(/sandbox-page-code-123|user-id-4567/)
    expect(out).toMatchObject({ err: { id: 54, message: 'pageCode <redacted secret> invalid for <redacted secret>' } })
    expect(redactKnownSecrets('failed card-token-abcdef', secrets)).toBe('failed <redacted secret>')
  })
})

describe('the probe script never prints stored values', () => {
  const src = readFileSync('scripts/grow-sandbox-probe.ts', 'utf8')
  it('does not echo the state file when it cannot be parsed (JSON errors quote the input)', () => {
    expect(src).toMatch(/state_file_unreadable/)
  })
  it('opens the hosted page instead of printing its url', () => {
    expect(src).not.toMatch(/console\.(log|error)\([^)]*\.url/)
  })
})

const DB_IMPORT = /-> (.*config\/db(\.ts)?|@\/db\/.*|.*\/db\/.*|knex|pg|@neondatabase\/.*)$/

describe('the probe cannot reach application data', () => {
  it.each(['@/config/db', '../config/db', '@/db/trial', '../../db/payments', 'knex', 'pg', '@neondatabase/serverless'])(
    'the check recognises a database import: %s',
    (spec) => expect(`x.ts -> ${spec}`).toMatch(DB_IMPORT),
  )
  it.each(['@/lib/pricing', './config', 'dotenv', 'child_process', '../lib/payments/grow/api'])('the check ignores %s', (spec) =>
    expect(`x.ts -> ${spec}`).not.toMatch(DB_IMPORT),
  )

  /** Follows every relative and @/ import from the probe, so a DB dependency added anywhere below it fails here. */
  function importGraph(entry: string): Map<string, string[]> {
    const seen = new Map<string, string[]>()
    const visit = (file: string) => {
      if (seen.has(file)) return
      const src = readFileSync(file, 'utf8')
      const specs = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1])
      seen.set(file, specs)
      for (const spec of specs) {
        if (!spec.startsWith('.') && !spec.startsWith('@/')) continue
        const base = spec.startsWith('@/') ? spec.slice(2) : join(dirname(file), spec)
        const resolved = [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find((p) => existsSync(p))
        if (!resolved) throw new Error(`unresolved import ${spec} in ${file}`)
        visit(resolved)
      }
    }
    visit(entry)
    return seen
  }

  it('no module reachable from scripts/grow-sandbox-probe.ts imports a database client', () => {
    const graph = importGraph('scripts/grow-sandbox-probe.ts')
    expect(graph.has('lib/payments/grow/api.ts')).toBe(true)
    for (const [file, specs] of graph) {
      for (const spec of specs) expect(`${file} -> ${spec}`).not.toMatch(DB_IMPORT)
    }
  })
})
