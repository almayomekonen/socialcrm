/**
 * scripts/seal_facebook_page_tokens.cjs — the migration of EXISTING plaintext
 * Page tokens, run as the real script against the real test database.
 *
 * Proves: dry run writes nothing; --apply seals every plaintext row and leaves
 * sealed rows untouched; the sealed values open to the original tokens with the
 * application's own resolver; re-running is idempotent; --verify fails on
 * plaintext or an unreadable seal; and NO output line ever contains a token.
 *
 * Run: npm run test:db -- __tests__/facebook/sealPageTokensScript.db.test.ts
 */
import { spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { resolvePageAccessToken, sealPageAccessToken } from '@/lib/facebook/pageToken'

const KEY = Buffer.alloc(32, 11).toString('base64')
const OTHER_KEY = Buffer.alloc(32, 12).toString('base64')
const PLAIN_A = 'EAAGplaintextTokenAAAAAAAAAAAAAAAAAAAA1'
const PLAIN_B = 'EAAGplaintextTokenBBBBBBBBBBBBBBBBBBBB2'
const ALREADY = 'EAAGalreadySealedTokenCCCCCCCCCCCCCCCC3'
const PAGES = ['__seal_a__', '__seal_b__', '__seal_c__']
let agency = 0

function run(args: string[], key = KEY) {
  const res = spawnSync('node', ['scripts/seal_facebook_page_tokens.cjs', ...args], {
    env: { ...process.env, ENV_FILE: '.env.test', SECRETS_ENC_KEY: key },
    encoding: 'utf8',
  })
  const output = `${res.stdout}\n${res.stderr}`
  // The one property that must hold on every run, in every mode.
  for (const secret of [PLAIN_A, PLAIN_B, ALREADY, KEY, OTHER_KEY, ...PAGES]) expect(output).not.toContain(secret)
  return { code: res.status, output }
}

const tokens = async () =>
  Object.fromEntries(
    ((await db('facebook_pages').whereIn('page_id', PAGES).select('page_id', 'page_access_token')) as { page_id: string; page_access_token: string }[]).map(
      (r) => [r.page_id, r.page_access_token],
    ),
  )

beforeAll(async () => {
  process.env.SECRETS_ENC_KEY = KEY
  const [a] = await db('agencies').insert({ name: '__test_seal__' }).returning('id')
  agency = Number(a.id)
  const [u] = await db('users').insert({ firstName: 'S', role: 'ADMIN', agencyId: agency }).returning('id')
  await db('facebook_pages').insert([
    { user_id: u.id, agency_id: agency, page_id: PAGES[0], page_name: 'A', page_access_token: PLAIN_A },
    { user_id: u.id, agency_id: agency, page_id: PAGES[1], page_name: 'B', page_access_token: PLAIN_B },
    { user_id: u.id, agency_id: agency, page_id: PAGES[2], page_name: 'C', page_access_token: sealPageAccessToken(ALREADY) },
  ])
})

afterAll(async () => {
  await db('facebook_pages').whereIn('page_id', PAGES).del()
  await db('users').where({ agencyId: agency }).del()
  await db('agencies').where({ id: agency }).del()
  await db.destroy()
})

describe('sealing existing plaintext Page tokens', () => {
  it('dry run reports and writes nothing', async () => {
    const before = await tokens()
    const { code, output } = run([])
    expect(code).toBe(0)
    expect(output).toMatch(/mode=dry-run .*plaintext=\d+/)
    expect(await tokens()).toEqual(before)
  })

  it('--verify fails while plaintext remains', () => {
    const { code, output } = run(['--verify'])
    expect(code).toBe(1)
    expect(output).toMatch(/plaintext=[1-9]/)
  })

  it('--apply seals every plaintext row, leaves sealed rows untouched, and the app resolver opens them to the originals', async () => {
    const before = await tokens()
    const { code, output } = run(['--apply'])
    expect(code).toBe(0)
    expect(output).toMatch(/plaintext_remaining=0/)

    const after = await tokens()
    expect(after[PAGES[0]].startsWith('scm1.')).toBe(true)
    expect(after[PAGES[1]].startsWith('scm1.')).toBe(true)
    expect(after[PAGES[2]]).toBe(before[PAGES[2]])
    expect(resolvePageAccessToken(after[PAGES[0]])).toBe(PLAIN_A)
    expect(resolvePageAccessToken(after[PAGES[1]])).toBe(PLAIN_B)
    expect(resolvePageAccessToken(after[PAGES[2]])).toBe(ALREADY)
  })

  it('is idempotent, and --verify passes with the right key', async () => {
    const before = await tokens()
    expect(run(['--apply']).output).toMatch(/sealed=0 .*plaintext_remaining=0/)
    expect(await tokens()).toEqual(before)
    const { code, output } = run(['--verify'])
    expect(code).toBe(0)
    expect(output).toMatch(/plaintext=0 unreadable_seals=0/)
  })

  it('--verify with the WRONG key reports unreadable seals (a deploy-config fault caught before it disconnects Pages)', () => {
    const { code, output } = run(['--verify'], OTHER_KEY)
    expect(code).toBe(1)
    expect(output).toMatch(/unreadable_seals=[1-9]/)
  })

  it('--unseal (emergency rollback) needs explicit confirmation, then restores the originals; --apply re-seals', async () => {
    const sealedState = await tokens()
    const refused = run(['--unseal', '--apply'])
    expect(refused.code).toBe(1)
    expect(refused.output).toContain('--confirm-writes-plaintext')
    expect(await tokens()).toEqual(sealedState)

    const { code, output } = run(['--unseal', '--apply', '--confirm-writes-plaintext'])
    expect(code).toBe(0)
    expect(output).toMatch(/sealed_remaining=0/)
    const plain = await tokens()
    expect([plain[PAGES[0]], plain[PAGES[1]], plain[PAGES[2]]]).toEqual([PLAIN_A, PLAIN_B, ALREADY])

    expect(run(['--apply']).code).toBe(0)
    const resealed = await tokens()
    expect(Object.values(resealed).every((t) => t.startsWith('scm1.'))).toBe(true)
  })

  it('refuses to run without SECRETS_ENC_KEY, touching nothing', async () => {
    const before = await tokens()
    const { code, output } = run(['--apply'], '')
    expect(code).toBe(1)
    expect(output).toContain('SECRETS_ENC_KEY is not set')
    expect(await tokens()).toEqual(before)
  })
})
