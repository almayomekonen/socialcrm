import { NextRequest, NextResponse } from 'next/server'
import { getLeadsWaitingForReply } from '@/services/automation/recoveryEngine'
import { getAutomationSecret, isAutomationAuthorized } from '@/lib/automation/apiAuth'

function numberParam(value: string | null): number | undefined {
  if (value == null) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

export async function GET(req: NextRequest) {
  const secret = getAutomationSecret()
  if (!secret) {
    console.error('[recovery-leads] AUTOMATION_API_KEY / CRON_SECRET is not set')
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }
  if (!isAutomationAuthorized(req, secret)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { searchParams } = new URL(req.url)
    const leads = await getLeadsWaitingForReply({
      thresholdMinutes: numberParam(searchParams.get('minutes')),
      agencyId: numberParam(searchParams.get('agencyId')),
    })
    return NextResponse.json(leads)
  } catch (err) {
    console.error('[recovery-leads] failed', { reason: (err as Error)?.message })
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
