import { NextRequest, NextResponse } from 'next/server'
import { isGrowLocalMockEnabled, localMockOrigin } from '@/lib/payments/grow/localMock'

/**
 * The mocked hosted page "completing": posts a synthetic Grow callback to the
 * REAL /api/payments/grow/notify route (same form encoding Grow documents), then
 * sends the browser to the success URL — exactly the shape of the real flow.
 * 404 unless the local mock is enabled.
 */
export async function POST(req: NextRequest) {
  if (!isGrowLocalMockEnabled()) return new NextResponse('Not found', { status: 404 })
  const form = await req.formData()
  const successUrl = String(form.get('successUrl') || '/dashboard')

  const body = new URLSearchParams({
    processId: String(form.get('processId') || ''),
    processToken: String(form.get('processToken') || ''),
    cardToken: String(form.get('cardToken') || ''),
    cField1: String(form.get('reference') || ''),
    statusCode: 'MOCK-SAVED',
    sum: '1',
    transactionId: 'mock-tx',
    transactionToken: 'mock-tx-token',
    cardSuffix: '4242',
    cardBrand: 'Visa',
    cardExp: '1230',
  })

  const res = await fetch(new URL('/api/payments/grow/notify', localMockOrigin()), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  }).catch(() => null)
  console.log('[GrowLocalMock] callback delivered', { status: res?.status ?? 'network_error' })

  return NextResponse.redirect(new URL(successUrl, localMockOrigin()), 303)
}
