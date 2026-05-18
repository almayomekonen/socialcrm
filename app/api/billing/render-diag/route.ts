import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/config/db'

export async function GET(request: NextRequest) {
  const expected = process.env.RENDER_DIAG_SECRET?.trim()
  const provided = request.headers.get('x-render-diag-secret') ?? request.nextUrl.searchParams.get('secret')

  if (!expected) {
    return NextResponse.json({ ok: false, reason: 'render-diag-secret-not-configured' }, { status: 503 })
  }
  if (!provided || provided !== expected) {
    return NextResponse.json({ ok: false, reason: 'forbidden' }, { status: 401 })
  }

  const invoiceIdParam = request.nextUrl.searchParams.get('invoiceId')
  const documentIdParam = request.nextUrl.searchParams.get('documentId')
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') ?? 5), 1), 20)

  let query = db('bill_documents').select('id', 'agencyId', 'invoiceId', 'status', 'errorReason', 'metadata', 'createdAt', 'renderedAt')

  if (documentIdParam) {
    query = query.where({ id: Number(documentIdParam) })
  } else if (invoiceIdParam) {
    query = query.where({ invoiceId: Number(invoiceIdParam) })
  }

  const rows = await query.orderBy('id', 'desc').limit(limit)

  return NextResponse.json(
    {
      ok: true,
      count: rows.length,
      documents: rows.map((r: Record<string, unknown>) => ({
        id: Number(r.id),
        invoiceId: Number(r.invoiceId),
        agencyId: Number(r.agencyId),
        status: r.status,
        errorReason: r.errorReason,
        createdAt: r.createdAt,
        renderedAt: r.renderedAt,
        diag: ((r.metadata as Record<string, unknown> | null)?.diag as unknown[]) ?? [],
      })),
    },
    { status: 200 },
  )
}
