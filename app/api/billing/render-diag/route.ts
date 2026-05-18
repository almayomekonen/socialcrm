import { NextRequest, NextResponse } from 'next/server'
import { readDiag, clearDiag } from '@/lib/billing/pdf/diag'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const expected = process.env.RENDER_DIAG_SECRET?.trim()
  const provided = request.headers.get('x-render-diag-secret') ?? request.nextUrl.searchParams.get('secret')

  if (!expected) {
    return NextResponse.json({ ok: false, reason: 'render-diag-secret-not-configured' }, { status: 503 })
  }
  if (!provided || provided !== expected) {
    return NextResponse.json({ ok: false, reason: 'forbidden' }, { status: 401 })
  }

  const contents = readDiag()
  const shouldClear = request.nextUrl.searchParams.get('clear') === '1'
  if (shouldClear) {
    clearDiag()
  }
  return new NextResponse(contents, {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}
