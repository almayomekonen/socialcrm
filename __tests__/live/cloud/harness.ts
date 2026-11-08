import { S3Client } from '@aws-sdk/client-s3'
import { writeFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { vi } from 'vitest'
import { db } from '@/config/db'
import { encrypt } from '@/db/auth'
import { createQuoteSystem } from '@/db/quotes/createQuote'
import { GET } from '@/app/api/quotes/[quoteId]/download/route'
import { deleteObject, getObjectBytes, listObjects } from '@/lib/storage/objects'
import { startQuotePdf } from '@/lib/waAssistant/quotes/pdfJob'
import { HarnessRefused } from '../quote/safety'
import { createArtifacts } from './artifacts'
import { CLOUD_AGENCY, CLOUD_EXEMPT_AGENCY, type CloudContext } from './env'
import { dryOps, pdfText } from './helpers'
import { kindOfCommand } from './r2Limit'
import { session } from './session'

/** Shared by the case files. run.live.ts is the one spec, so one process counts the whole run. */

export const ctx = (globalThis as unknown as { __quoteCloud: CloudContext }).__quoteCloud
export const artifacts = createArtifacts(ctx.mode)
export const notice = { send: vi.fn(async () => ({ kind: 'sent' as const, wamid: 'wamid.CLOUD' })) as never }
export const USER = 998010
export const EXEMPT_USER = 998020
export const REP_WITH_LEAD = 998011
export const REP_WITHOUT_LEAD = 998012
const TENANTS = [CLOUD_AGENCY, CLOUD_EXEMPT_AGENCY]
export const APPROVED_PREFIXES = TENANTS.map((a) => `tenants/${a}/`)
export const leads = { main: 0, exempt: 0, rep: 0 }
let seq = 0

export type QuoteOver = { discountPercent?: number; unitAmount?: number; priceBasis?: 'incl_vat' | 'excl_vat' | null; exempt?: boolean; leadId?: number; lineTitles?: string[]; sweepable?: boolean; automationKey?: string }

/** Only `sweepable` quotes are WhatsApp-sourced: the sweep reads the 10 oldest, so the rest must not fill its window. */
export async function quote(lines: number, over: QuoteOver = {}) {
  const unitAmount = over.unitAmount ?? 1000
  const r = await createQuoteSystem({
    agencyId: over.exempt ? CLOUD_EXEMPT_AGENCY : CLOUD_AGENCY,
    leadId: over.leadId ?? (over.exempt ? leads.exempt : leads.main),
    createdByUserId: over.exempt ? EXEMPT_USER : USER,
    title: 'שיפוץ מטבח כולל ארונות',
    lines: Array.from({ length: lines }, (_, i) => ({ title: over.lineTitles?.[i] ?? `פריט בדיקה מספר ${i + 1}`, quantity: 1, unitAmount, discountAmount: over.discountPercent ? (unitAmount * over.discountPercent) / 100 : undefined })),
    priceBasis: over.priceBasis === undefined ? 'excl_vat' : over.priceBasis,
    validityDays: 30,
    finalize: true,
    automationKey: over.automationKey ?? `cloud:${++seq}:${Date.now()}`,
    metadata: { source: over.sweepable ? 'wa_assistant' : 'cloud_harness', actionId: `act_cloud_${++seq}` },
  })
  if (r.ok === false) throw new Error('quote not created')
  return r
}

export const docsOf = (quoteId: number) => db('sales_quote_documents').where({ quoteId }).orderBy('id').select('status', 'isCurrent', 'path', 'contentHash', 'byteSize', 'failureReason')
export const start = (quoteId: number, deps: Record<string, unknown> = {}, agencyId = CLOUD_AGENCY) => startQuotePdf({ agencyId, quoteId, renderedByUserId: USER, inline: true, deps: { notice, ...deps } as never })
export const open = (handle: string) => GET(new NextRequest(`https://crm.test/api/quotes/${handle}/download`), { params: Promise.resolve({ quoteId: handle }) })
export const signIn = async (id: number) => {
  session.cookie = await encrypt({ id, sv: 0, typ: 'session' })
}

/** The document's text and page count, with the PDF and its page images kept for review. */
export async function readDocument(quoteId: number, scenario: string, description: string) {
  const [d] = await docsOf(quoteId)
  if (d?.status !== 'ready') throw new Error(`${scenario}: the document is not ready`)
  const bytes = await getObjectBytes(d.path)
  await artifacts.save(scenario, description, bytes)
  return { ...(await pdfText(bytes)), bytes, doc: d }
}

/** Every object in the bucket, across pages. A failed listing throws: "could not look" is not "empty". */
export async function allObjects(): Promise<string[]> {
  const keys: string[] = []
  let cursor: string | undefined
  do {
    const page = await listObjects({ prefix: '', cursor })
    keys.push(...page.objects.map((o) => o.key))
    cursor = page.nextCursor
  } while (cursor)
  return keys
}

/** Counts only: a wrong bucket's object names must never reach the output. */
export async function assertBucketEmpty(when: string): Promise<void> {
  const left = (await allObjects()).length
  if (left) throw new HarnessRefused(`the bucket must be empty ${when}, and holds ${left} objects`)
}

export const isApprovedKey = (key: string) => APPROVED_PREFIXES.some((p) => key.startsWith(p))
export const wallRefusals: string[] = []

/** Every keyed S3 call must be a known kind, name the configured bucket and an approved prefix, and fit its limit. */
export function installObjectWall(): void {
  const inner = S3Client.prototype.send
  S3Client.prototype.send = function (this: S3Client, command: { input: { Bucket?: string; Key?: string } }, ...rest: unknown[]) {
    const { Bucket, Key } = command.input
    const kind = kindOfCommand(command.constructor.name)
    if (!kind || Bucket !== process.env.R2_BUCKET_NAME || (Key !== undefined && !isApprovedKey(Key))) {
      wallRefusals.push(command.constructor.name)
      return Promise.reject(new HarnessRefused('an S3 call outside the synthetic tenants'))
    }
    try {
      ctx.r2Counter.begin(kind, Key)
    } catch (err) {
      return Promise.reject(err)
    }
    return Promise.resolve((inner as (...a: unknown[]) => unknown).call(this, command, ...rest)).then(
      (result) => (ctx.r2Counter.succeed(kind, Key), result),
      (err) => {
        ctx.r2Counter.fail(kind, Key)
        throw err
      },
    )
  } as never
}

export async function removeSyntheticObjects(): Promise<void> {
  for (const key of (await allObjects()).filter(isApprovedKey)) await deleteObject(key)
}

export async function createFixtures(): Promise<void> {
  const client = (firstName: string, lastName: string, phone: string, agencyId: number, userId: number) => db('clients').insert({ firstName, lastName, phone, agencyId, userId, createdById: userId, lead: true, status: 'new' }).returning('id')
  const addAgency = async (id: number, name: string, businessType: string, userId: number, email: string) => {
    await db('agencies').insert({ id, name, plan: 'pro' } as never).onConflict('id').ignore()
    await db.raw(`UPDATE agencies SET "businessType" = ? WHERE id = ?`, [businessType, id])
    await db('users').insert({ id: userId, agencyId: id, email, role: 'ADMIN', firstName: 'א', lastName: 'ב' } as never).onConflict('id').ignore()
  }
  await addAgency(CLOUD_AGENCY, 'עסק בדיקה סינתטי', 'authorized', USER, 'cloud@t.test')
  await addAgency(CLOUD_EXEMPT_AGENCY, 'עסק פטור סינתטי', 'exempt', EXEMPT_USER, 'cloud-exempt@t.test')
  await db('bill_tax_rates').where({ agencyId: CLOUD_AGENCY }).del()
  await db('bill_tax_rates').insert({ agencyId: CLOUD_AGENCY, code: 'VAT_STD', label: 'מע"מ', ratePercent: 18, country: 'IL', effectiveFrom: '2024-01-01' })
  await db('users').insert([REP_WITH_LEAD, REP_WITHOUT_LEAD].map((id) => ({ id, agencyId: CLOUD_AGENCY, email: `r${id}@t.test`, role: 'AGNT', firstName: 'נ', lastName: String(id) })) as never).onConflict('id').ignore()
  leads.main = Number((await client('דוד', 'כהן', '0501234567', CLOUD_AGENCY, USER))[0].id)
  leads.exempt = Number((await client('רונית', 'לוי', '0501234568', CLOUD_EXEMPT_AGENCY, EXEMPT_USER))[0].id)
  leads.rep = Number((await client('דוד', 'כהן', '0501234569', CLOUD_AGENCY, REP_WITH_LEAD))[0].id)
  await signIn(USER)
}

export async function removeFixtures(): Promise<void> {
  for (const t of ['sales_quotes', 'bill_numbering_sequences', 'bill_tax_rates', 'clients', 'users']) await db(t).whereIn('agencyId', TENANTS).del()
  await db('agencies').whereIn('id', TENANTS).del()
}

/** Dry mode only: what happened, for the guard suite to check from outside the run. */
export async function writeDryLog(): Promise<void> {
  const file = process.env.QUOTE_CLOUD_DRY_LOG
  if (!file || ctx.mode !== 'dry') return
  const store = (globalThis as unknown as { __dryBucket?: Map<string, unknown> }).__dryBucket
  writeFileSync(file, JSON.stringify({ ...dryOps, remaining: [...(store?.keys() ?? [])], limiter: ctx.limiter, limits: ctx.limits, r2: ctx.r2, r2Limits: ctx.r2Limits, wallRefusals }))
}
