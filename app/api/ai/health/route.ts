import { NextRequest, NextResponse } from 'next/server'
import { runHealthCheck } from '@/lib/ai/healthcheck'
import { getAiEnv } from '@/lib/ai/env'

export async function GET(request: NextRequest) {
  const env = getAiEnv()
  const expected = env.healthSecret
  const provided = request.headers.get('x-ai-health-secret')

  if (!expected) {
    return NextResponse.json({ ok: false, reason: 'health-secret-not-configured' }, { status: 503 })
  }
  if (!provided || provided !== expected) {
    return NextResponse.json({ ok: false, reason: 'forbidden' }, { status: 401 })
  }

  const results = await runHealthCheck()
  return NextResponse.json({ ok: true, results })
}
