import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * Real Next.js after() and cron recovery. The card is prepared in this process;
 * a real `next start` then takes the approval through the real cron route. The
 * server runs with serverGuard.cjs loaded first and an environment built here
 * (nothing inherited), so it can reach only loopback and this local database.
 * Meta, R2 and the PDF renderer are the local fakes in ./fakes.ts.
 */
vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))

import { db } from '@/config/db'
import { processPlatformMessage } from '@/lib/whatsapp/platform/inbound'
import { runWaAssistantWorker } from '@/lib/waAssistant/worker'
import { agency, recipient, user } from '../../ownerWhatsappReminders/reminderFixtures'
import { AUTHORIZED_AGENCY, type LiveContext } from '../quote/env'
import { startFakes } from './fakes'

const ctx = (globalThis as unknown as { __quoteLive: LiveContext }).__quoteLive
const CRON_SECRET = 'after-harness-cron-secret-not-real'
const OWNER = '972500007999'
const GUARD = path.resolve('__tests__/live/after/serverGuard.cjs')
const dir = mkdtempSync(path.join(os.tmpdir(), 'quote-after-'))
const refusalsFile = path.join(dir, 'refusals.log')
const serverLog = path.join(dir, 'server.log')
const SWEEP_AGE_MS = 3 * 60 * 1000

let fakes: Awaited<ReturnType<typeof startFakes>>
let port = 0
let server: ChildProcess | null = null
let leadId = 0
let seq = 0

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as AddressInfo).port
      s.close(() => resolve(p))
    })
  })

function serverEnv(): NodeJS.ProcessEnv {
  const ids = String(AUTHORIZED_AGENCY)
  const dbEnv = path.join(dir, 'server.env')
  writeFileSync(dbEnv, `DATABASE_URL=${process.env.DATABASE_URL}\n`, { mode: 0o600 })
  const base = `http://127.0.0.1:${port}`
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    NODE_OPTIONS: `--require ${GUARD}`,
    DATABASE_URL: process.env.DATABASE_URL,
    APP_ENV_FILE: dbEnv,
    CRON_SECRET,
    JWT_SECRET: process.env.JWT_SECRET,
    SECRETS_ENC_KEY: process.env.SECRETS_ENC_KEY,
    APP_URL: base,
    NEXT_PUBLIC_APP_URL: base,
    // The approval path needs the assistant's switches on. The key is the self-test placeholder; no model is called here.
    AI_ENABLED: 'true',
    AI_PROVIDERS: 'openai',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    AI_AGENCY_ALLOWLIST: ids,
    AGENT_AGENCY_IDS: ids,
    AGENT_OPENAI_MODEL: process.env.AGENT_OPENAI_MODEL,
    AI_DAILY_USD_CAP: '100',
    WA_ASSISTANT_DAILY_USD_CAP: '100',
    WA_ASSISTANT_AGENCY_IDS: ids,
    WA_ASSISTANT_QUOTES_AGENCY_IDS: ids,
    OWNER_WA_REMINDERS_AGENCY_IDS: ids,
    PLATFORM_WHATSAPP_PHONE_NUMBER_ID: '1000000000001',
    PLATFORM_WHATSAPP_ACCESS_TOKEN: 'EAAG_harness_fake_token_not_real',
    PDF_RENDERER: 'gotenberg',
    PDF_RENDER_URL: `http://127.0.0.1:${fakes.port}`,
    GOTENBERG_API_BASIC_AUTH_USERNAME: 'fake',
    GOTENBERG_API_BASIC_AUTH_PASSWORD: 'fake',
    R2_ACCOUNT_ID: 'a'.repeat(32),
    R2_ACCESS_KEY_ID: 'FAKEKEYID',
    R2_SECRET_ACCESS_KEY: 'fake-secret',
    R2_BUCKET_NAME: 'after-harness-test',
    AFTER_FAKE_PORT: String(fakes.port),
    AFTER_REFUSALS_FILE: refusalsFile,
  } as NodeJS.ProcessEnv
}

/** Plain http on purpose: the test process's fetch is the scripted model. */
const call = (method: string, url: string, headers: Record<string, string> = {}) =>
  new Promise<{ status: number; body: string; at: number }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: url, method, headers }, (res) => {
      const parts: Buffer[] = []
      res.on('data', (c) => parts.push(c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(parts).toString('utf8'), at: Date.now() }))
    })
    req.on('error', reject)
    req.end()
  })
const cron = () => call('POST', '/api/cron/wa-assistant', { authorization: `Bearer ${CRON_SECRET}` })

async function waitFor(what: string, ok: () => boolean | Promise<boolean>, ms = 45_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await ok()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`timed out waiting for ${what}; server log: ${serverLog}`)
}

async function startServer() {
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], { env: serverEnv(), detached: true, stdio: ['ignore', openSync(serverLog, 'a'), openSync(serverLog, 'a')] })
  await waitFor('the server', async () => (await call('POST', '/api/cron/wa-assistant').catch(() => ({ status: 0 }))).status === 403, 60_000)
}
async function killServer() {
  const child = server
  server = null
  if (!child?.pid) return
  const gone = new Promise((resolve) => child.once('exit', resolve))
  process.kill(-child.pid, 'SIGKILL')
  await gone
}

const docs = (quoteId: number) => db('sales_quote_documents').where({ quoteId }).orderBy('id').select('status', 'isCurrent', 'path', 'contentHash', 'byteSize', 'failureReason')
const pdfNotices = () => fakes.state.graph.filter((c) => JSON.stringify(c.body).includes('/api/quotes/'))
const refusals = () => (existsSync(refusalsFile) ? readFileSync(refusalsFile, 'utf8').split('\n').filter(Boolean) : [])

const message = (extra: Record<string, unknown>) => processPlatformMessage({ id: `wamid.__after_${++seq}`, from: OWNER, timestamp: String(Math.floor(Date.now() / 1000)), ...extra } as never)

/** The card is made here with the scripted model; the tap is left queued for the real server. */
async function queuedApproval(): Promise<void> {
  let approve = ''
  ctx.fake!.next = { findName: 'דוד כהן', headline: 'h', proposal: { actionType: 'create_quote', args: { clientId: leadId, title: 'שיפוץ מטבח', lines: [{ title: 'שיפוץ מטבח', quantity: null, unitAmount: 18500, discountAmount: null, discountPercent: null }], priceBasis: 'incl_vat', validityDays: null }, evidenceRefs: [`lead:${leadId}`] } }
  await message({ type: 'text', text: { body: `תכין הצעת מחיר לדוד כהן עבור שיפוץ מטבח, 18,500 שקל כולל מע"מ ${'.'.repeat(++seq % 3)}` } })
  await runWaAssistantWorker({}, { sendText: (async (i: { buttons?: { id: string }[] }) => ((approve = i.buttons?.[0]?.id ?? approve), { kind: 'sent' as const, wamid: `wamid.CARD_${++seq}` })) as never, typing: (async () => undefined) as never })
  expect(approve).toMatch(/^wa:approve:/)
  await message({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: approve, title: 'x' } } })
}
const newestQuote = async () => Number((await db('sales_quotes').where({ agencyId: AUTHORIZED_AGENCY }).max('id as id').first())?.id)

beforeAll(async () => {
  if (ctx.mode !== 'self' || !ctx.fake) throw new Error('self mode only: this harness never holds a real model key')
  if (!existsSync('.next/BUILD_ID')) throw new Error('no build: run the guarded next build first (docs/wa-quotes-validation-harness.md)')
  fakes = await startFakes()
  port = await freePort()
  await agency('__quote_after__', AUTHORIZED_AGENCY)
  await db.raw(`UPDATE agencies SET "businessType" = 'authorized', plan = 'pro' WHERE id = ?`, [AUTHORIZED_AGENCY])
  await db('bill_tax_rates').where({ agencyId: AUTHORIZED_AGENCY }).del()
  await db('bill_tax_rates').insert({ agencyId: AUTHORIZED_AGENCY, code: 'VAT_STD', label: 'מע"מ', ratePercent: 18, country: 'IL', effectiveFrom: '2024-01-01' })
  const owner = await user(AUTHORIZED_AGENCY, 'ADMIN')
  await recipient(AUTHORIZED_AGENCY, owner, OWNER, undefined, 'v4')
  const [c] = await db('clients').insert({ firstName: 'דוד', lastName: 'כהן', phone: '0527700001', agencyId: AUTHORIZED_AGENCY, userId: owner, createdById: owner, lead: true, status: 'new' }).returning('id')
  leadId = Number(c.id)
  await startServer()
})

afterAll(async () => {
  fakes?.release()
  await killServer()
  await fakes?.close()
  ctx.guard.uninstall()
})

describe('real next start', () => {
  it('the guard is on: a wrong cron secret is refused and the database is the local one', async () => {
    expect((await call('POST', '/api/cron/wa-assistant', { authorization: 'Bearer wrong' })).status).toBe(403)
    expect(new URL(process.env.DATABASE_URL as string).pathname).toBe('/socialcrm_quotes_test')
  })

  it('after(): the reply returns first, the render starts after it, and the PDF and notice follow', async () => {
    fakes.hold()
    await queuedApproval()
    const res = await cron()
    expect(res.status, res.body).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, claimed: 1 })
    const quoteId = await newestQuote()
    expect(await db('sales_quotes').where({ id: quoteId }).first('status')).toMatchObject({ status: 'ready' })

    await waitFor('the render to reach the renderer', () => fakes.state.renders === 1)
    // A fallback that was not after() would have started the render while the request was still running.
    expect(fakes.state.firstRenderAt).toBeGreaterThanOrEqual(res.at)
    process.stderr.write(`[after] render reached the renderer ${fakes.state.firstRenderAt - res.at} ms after the response\n`)
    expect(await docs(quoteId)).toMatchObject([{ status: 'rendering', isCurrent: false }])
    expect(pdfNotices()).toHaveLength(0)

    fakes.release()
    await waitFor('the PDF to be ready', async () => (await docs(quoteId))[0]?.status === 'ready')
    const [d] = await docs(quoteId)
    expect(d.isCurrent).toBe(true)
    const stored = fakes.state.objects.get(d.path)!
    expect(createHash('sha256').update(stored.body).digest('hex')).toBe(d.contentHash)
    expect(stored.sha256).toBe(d.contentHash)
    expect(Number(d.byteSize)).toBe(stored.body.byteLength)
    await waitFor('the owner notice', () => pdfNotices().length === 1)
    expect(JSON.stringify(pdfNotices()[0].body)).toContain(`/api/quotes/${d.contentHash}/download`)
    expect(pdfNotices()[0].body.to).toBe(OWNER)
  })

  it('a later tick repeats nothing', async () => {
    const before = { renders: fakes.state.renders, notices: pdfNotices().length }
    expect(JSON.parse((await cron()).body)).toMatchObject({ ok: true, claimed: 0 })
    expect({ renders: fakes.state.renders, notices: pdfNotices().length }).toEqual(before)
  })

  it('a server killed mid-render: the quote stands, and the real cron route recovers one PDF and one notice', async () => {
    const noticesBefore = pdfNotices().length
    const rendersBefore = fakes.state.renders
    fakes.hold()
    await queuedApproval()
    expect(JSON.parse((await cron()).body)).toMatchObject({ ok: true, claimed: 1 })
    const quoteId = await newestQuote()
    await waitFor('the render to start', () => fakes.state.renders === rendersBefore + 1)

    await killServer()
    fakes.release()
    expect(await db('sales_quotes').where({ id: quoteId }).first('status')).toMatchObject({ status: 'ready' })
    expect(await docs(quoteId)).toMatchObject([{ status: 'rendering' }])
    expect(pdfNotices()).toHaveLength(noticesBefore)

    await startServer()
    // Only the row's age is moved; the stale limit itself stays the product's.
    await db('sales_quote_documents').where({ quoteId, status: 'rendering' }).update({ createdAt: new Date(Date.now() - SWEEP_AGE_MS) })
    const res = await cron()
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, claimed: 0 })

    const rows = await docs(quoteId)
    expect(rows.map((d) => d.failureReason ?? d.status)).toEqual(['stale_render', 'ready'])
    expect(rows.filter((d) => d.isCurrent)).toHaveLength(1)
    expect(fakes.state.objects.has(rows[1].path)).toBe(true)
    await waitFor('the recovery notice', () => pdfNotices().length === noticesBefore + 1)
    expect(JSON.parse((await cron()).body)).toMatchObject({ ok: true, claimed: 0 })
    expect(pdfNotices()).toHaveLength(noticesBefore + 1)
  })

  it('nothing tried to leave the machine, and Meta was only ever asked to message the owner', () => {
    expect(refusals()).toEqual([])
    expect(ctx.guard.refusals).toEqual([])
    const recipients = new Set(fakes.state.graph.map((c) => c.body.to).filter(Boolean))
    expect([...recipients]).toEqual([OWNER])
  })
})
