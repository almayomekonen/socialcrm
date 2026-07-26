import { NextRequest, NextResponse } from 'next/server'
import { getAutomationSecret, isAutomationAuthorized } from '@/lib/automation/apiAuth'
import { runWhatsappTemplatesAnnouncement } from '@/lib/emailAutomations/announcements/whatsappTemplates'

export const maxDuration = 60

/**
 * One-time isolated trigger for the WhatsApp ready-made messages announcement.
 * POST-only (never GET, so it can't fire from a link/preview), authenticated with
 * the shared automation secret. Runs the final safety checks and, only if they all
 * pass, sends the approved announcement to exactly the eligible audience — once
 * each (send-once), suppression respected, in production so unsubscribe signing and
 * the sender are correct. Idempotent: re-POSTing skips already-sent recipients.
 * Touches nothing in the lifecycle scheduler, cooldown, or the global flag.
 */
async function handle(req: NextRequest) {
  const secret = getAutomationSecret()
  if (!secret) {
    console.error('[announce:wa-templates] AUTOMATION_API_KEY/CRON_SECRET not set')
    return new NextResponse('Internal Server Error', { status: 500 })
  }
  if (!isAutomationAuthorized(req, secret)) {
    return new NextResponse('Forbidden', { status: 403 })
  }
  const result = await runWhatsappTemplatesAnnouncement()
  return NextResponse.json(result, { status: result.ok ? 200 : 409 })
}

export async function POST(req: NextRequest) {
  return handle(req)
}
