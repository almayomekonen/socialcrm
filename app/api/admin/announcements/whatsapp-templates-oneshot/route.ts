import { NextRequest, NextResponse } from 'next/server'
import { runWhatsappTemplatesAnnouncement } from '@/lib/emailAutomations/announcements/whatsappTemplates'

export const maxDuration = 60

/**
 * TEMPORARY one-shot trigger — added solely to fire the approved WhatsApp
 * ready-made-messages announcement ONCE from inside the Vercel Production runtime,
 * where CRON_SECRET (unsubscribe signing), RESEND, and DATABASE_URL are available.
 * Gated by a single-use random token generated at authoring time (not CRON_SECRET,
 * not AUTOMATION_API_KEY). It only calls the existing, already-approved send
 * function, which itself runs every safety assertion (audience=38, sender, subject,
 * preheader, CTA, no-dashes, unsubscribe present) and is send-once/idempotent.
 * This file is deleted immediately after the single send; once removed the token
 * authorizes nothing.
 */
const ONESHOT_TOKEN = 'f23908ba2112c38fff231a4fbd7cd337dd8831f5e7d817cf'

export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get('t') !== ONESHOT_TOKEN) {
    return new NextResponse('Forbidden', { status: 403 })
  }
  const result = await runWhatsappTemplatesAnnouncement()
  return NextResponse.json(result, { status: result.ok ? 200 : 409 })
}
