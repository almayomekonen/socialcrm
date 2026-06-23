import { NextRequest, NextResponse } from 'next/server'
import { getAutomationSecret, isAutomationAuthorized } from '@/lib/automation/apiAuth'
import { createRecoveryAlertForLead } from '@/db/recoveryAlerts'

export async function POST(req: NextRequest) {
  const secret = getAutomationSecret()
  if (!secret) {
    console.error('[create-recovery-alert] AUTOMATION_API_KEY / CRON_SECRET is not set')
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }
  if (!isAutomationAuthorized(req, secret)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const leadId = Number((body as { leadId?: unknown })?.leadId)
  if (!Number.isInteger(leadId) || leadId <= 0) {
    return NextResponse.json({ error: 'leadId must be a positive integer' }, { status: 400 })
  }

  try {
    const result = await createRecoveryAlertForLead(leadId)
    // 201 when an alert was created; 200 when intentionally skipped (already
    // open, or the lead is no longer waiting). Both are success for n8n.
    return NextResponse.json(result, { status: result.created ? 201 : 200 })
  } catch (err) {
    console.error('[create-recovery-alert] failed', { leadId, reason: (err as Error)?.message })
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
