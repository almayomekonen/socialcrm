/**
 * Operator script: ONE SmartBee SANDBOX document through the real client code
 * (payload.ts → documents.ts → auth.ts → http.ts), without WhatsApp and without
 * any database. For the direct Sandbox checklist (docs/smartbee-sandbox-checklist.md).
 *
 *   SMARTBEE_TEST_CLIENT_ID=… SMARTBEE_TEST_CLIENT_PASSWORD=… \
 *   SMARTBEE_PROVIDER_USER_TOKEN=<sandbox business token> \
 *   npx tsx scripts/smartbee/sandbox-document.ts --type InvoiceReceipt --amount 100 \
 *     --vat incl --payment cash --business-type authorized [--msg-id <id>] [--apply]
 *
 *   npx tsx scripts/smartbee/sandbox-document.ts --poll <apiMessageId> --apply
 *
 * SANDBOX ONLY: the environment is hard-wired to `test`; there is no flag for
 * production. Without --apply it prints the exact request body (never the token)
 * and sends nothing.
 *
 * RE-RUN SAFELY: the providerMsgId is printed. After a timeout or any unclear
 * answer, re-run with --msg-id <that id>: SmartBee answers 95 with the ORIGINAL
 * message id instead of creating a second document. A new id = a new document.
 */
import { buildSmartbeeBody, validateDocumentDraft, type DocumentDraft, type PaymentMethod } from '../../lib/integrations/providers/smartbee/payload'
import { createSmartbeeDocument, pollSmartbeeDocument } from '../../lib/integrations/providers/smartbee/documents'
import type { IssuerBusinessType } from '../../lib/integrations/core/types'
import type { SmartbeeDocType } from '../../lib/integrations/providers/smartbee/types'

const ENV = 'test' as const
const args = process.argv.slice(2)
const flag = (n: string) => args.includes(`--${n}`)
const value = (n: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : undefined
}
const fail = (m: string): never => {
  console.error(`REFUSED: ${m}`)
  process.exit(1)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function poll(apiMessageId: string): Promise<void> {
  // The guide's schedule: 1 s, 2 s, 4 s … 30 s, about two minutes in all.
  for (let i = 0, wait = 1000; i < 9; i++, wait = Math.min(wait * 2, 30_000)) {
    const r = await pollSmartbeeDocument(ENV, apiMessageId)
    console.log(`poll ${i + 1}:`, JSON.stringify(r))
    if (r.kind !== 'processing' && r.kind !== 'retry') return
    await sleep(wait)
  }
  console.log(`still not final; poll again later with --poll ${apiMessageId} --apply`)
}

async function main(): Promise<void> {
  const apply = flag('apply')
  const pollId = value('poll')
  if (pollId) {
    if (!apply) fail('add --apply to call the SmartBee sandbox')
    return poll(pollId)
  }

  const docType = value('type') as SmartbeeDocType | undefined
  if (docType !== 'Invoice' && docType !== 'Receipt' && docType !== 'InvoiceReceipt') fail('--type must be Invoice, Receipt or InvoiceReceipt')
  const businessType = value('business-type') as IssuerBusinessType | undefined
  if (businessType !== 'exempt' && businessType !== 'authorized' && businessType !== 'company') fail('--business-type must be exempt, authorized or company')
  const amount = Number(value('amount'))
  const vat = value('vat')
  const method = value('payment') as PaymentMethod | undefined
  const draft: DocumentDraft = {
    docType: docType!,
    description: value('description') ?? 'בדיקת אינטגרציה SocialCRM',
    amount,
    vatOption: docType === 'Receipt' ? null : vat === 'incl' ? 'Include' : vat === 'excl' ? 'NotInclude' : null,
    payment:
      docType === 'Invoice' || !method
        ? null
        : {
            method,
            amount,
            paidOn: null,
            installments: value('installments') ? Number(value('installments')) : null,
            checkNumber: value('check-number') ?? null,
            reference: value('reference') ?? null,
            otherLabel: value('label') ?? null,
          },
    customer: { name: value('customer') ?? 'לקוח בדיקה SocialCRM', idNum: value('id-number') ?? null },
  }
  const valid = validateDocumentDraft(draft, businessType!)
  if (valid.ok === false) fail(`the draft is refused before any call: ${valid.reason}`)

  const providerMsgId = value('msg-id') ?? `scrm-sbx-${Date.now()}-${docType}`
  const body = buildSmartbeeBody(draft, { providerMsgId, providerMsgReferenceId: 'scrm-sandbox-checklist' })
  console.log('request body (providerUserToken added at send time, never printed):')
  console.log(JSON.stringify(body, null, 2))
  console.log(`providerMsgId: ${providerMsgId}  (re-run with --msg-id ${providerMsgId} after any unclear answer)`)
  if (!apply) return console.log('DRY RUN: nothing sent. Add --apply to call the SmartBee sandbox.')

  const token = process.env.SMARTBEE_PROVIDER_USER_TOKEN?.trim() || fail('SMARTBEE_PROVIDER_USER_TOKEN is not set')
  const r = await createSmartbeeDocument(ENV, body, token)
  console.log('create:', JSON.stringify(r))
  if (r.kind === 'accepted') await poll(r.providerRef)
}

main().catch((err) => {
  console.error('FAILED:', (err as Error)?.name ?? 'Error', (err as Error)?.message?.slice(0, 200) ?? '')
  process.exitCode = 1
})
