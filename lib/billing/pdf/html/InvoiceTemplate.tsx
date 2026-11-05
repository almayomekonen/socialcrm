import type { BillInvoiceRow, BillInvoiceLineRow } from '@/db/billing/invoices'
import type { IssuerData } from '@/lib/billing/issuer/fields'
import { COLOR, FONT_FAMILY, PAGE, SP } from './styles'
import { fontFaceBlock } from './fontEmbed'
import { DocumentHeader } from './components/DocumentHeader'
import { RecipientBlock } from './components/RecipientBlock'
import { LinesTable } from './components/LinesTable'
import { TotalsPanel } from './components/TotalsPanel'
import { ReceiptPanel, shouldRenderReceiptPanel } from './components/ReceiptPanel'
import { DocumentFooter } from './components/DocumentFooter'

// Top-level invoice template. Composes subcomponents — never owns layout or
// data manipulation. Responsibility is HTML-document framing (doctype, head,
// @page, font import, body wrapper) and section ordering.
//
// react-dom/server is loaded via DYNAMIC import: Next.js 16's RSC compiler
// rejects static imports of react-dom/server from any module reachable from
// the server-action graph (we're reached via actions/billing/render.ts →
// schedule.ts → renderInvoicePdf.ts). The dynamic-import form sidesteps that
// static analysis while preserving identical runtime behaviour. Module-level
// cache means we pay the import cost once per Node process.

export type InvoiceTemplateInput = {
  invoice: BillInvoiceRow
  lines: BillInvoiceLineRow[]
  issuer: IssuerData | null
  fallbackName: string
  agencyLogoPng?: Uint8Array | null
}

type RenderToStaticMarkup = (element: React.ReactElement) => string

let renderToStaticMarkupPromise: Promise<RenderToStaticMarkup> | null = null

async function getRenderToStaticMarkup(): Promise<RenderToStaticMarkup> {
  if (!renderToStaticMarkupPromise) {
    renderToStaticMarkupPromise = import('react-dom/server').then(
      (m) => m.renderToStaticMarkup as RenderToStaticMarkup,
    )
  }
  return renderToStaticMarkupPromise
}

export async function renderInvoiceHtml(input: InvoiceTemplateInput): Promise<string> {
  const displayName =
    (input.issuer?.name?.trim() || '') || (input.fallbackName?.trim() || '')
  const logoDataUri = input.agencyLogoPng?.byteLength
    ? `data:image/png;base64,${Buffer.from(input.agencyLogoPng).toString('base64')}`
    : null

  const renderToStaticMarkup = await getRenderToStaticMarkup()
  const body = renderToStaticMarkup(
    <InvoiceBody
      invoice={input.invoice}
      lines={input.lines}
      issuer={input.issuer}
      displayName={displayName}
      logoDataUri={logoDataUri}
    />,
  )

  return wrapDocument(body)
}

function InvoiceBody({
  invoice,
  lines,
  issuer,
  displayName,
  logoDataUri,
}: {
  invoice: BillInvoiceRow
  lines: BillInvoiceLineRow[]
  issuer: IssuerData | null
  displayName: string
  logoDataUri: string | null
}) {
  return (
    <main
      style={{
        // Top and bottom margins belong to @page below, so every page gets them,
        // not only the first and last.
        padding: `0 ${PAGE.margin}`,
        color: COLOR.text,
        fontFamily: FONT_FAMILY,
        fontSize: '11pt',
        lineHeight: 1.5,
      }}
    >
      <DocumentHeader
        invoice={invoice}
        issuer={issuer}
        displayName={displayName}
        logoDataUri={logoDataUri}
      />

      <Spacer height={SP.xxl} />
      <Hairline color={COLOR.ruleSoft} />
      <Spacer height={SP.xl} />

      <RecipientBlock invoice={invoice} />

      <Spacer height={SP.xxl} />

      <LinesTable lines={lines} />

      <Spacer height={SP.xl} />
      {/* One block, so the footer can never land alone on a page of its own. */}
      <div style={{ breakInside: 'avoid' }}>
        <TotalsPanel invoice={invoice} />

        {shouldRenderReceiptPanel(invoice) && (
          <>
            <Spacer height={SP.md} />
            <ReceiptPanel invoice={invoice} />
          </>
        )}

        <DocumentFooter
          customerFooter={invoice.customerFooter ?? ''}
          displayName={displayName}
        />
      </div>
    </main>
  )
}

function Hairline({ color }: { color: string }) {
  return (
    <hr
      style={{
        border: 0,
        borderTop: `1px solid ${color}`,
        margin: 0,
      }}
    />
  )
}

function Spacer({ height }: { height: string }) {
  return <div style={{ height, lineHeight: 0 }} />
}

function wrapDocument(body: string): string {
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<title>Invoice</title>
<style>
${fontFaceBlock()}
@page { size: ${PAGE.width} ${PAGE.height}; margin: ${PAGE.margin} 0; }
html, body { margin: 0; padding: 0; background: white; }
body { font-family: ${FONT_FAMILY}; color: ${COLOR.text}; }
* { box-sizing: border-box; }
</style>
</head>
<body>${body}</body>
</html>`
}
