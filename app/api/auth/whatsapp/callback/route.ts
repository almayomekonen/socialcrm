import { NextResponse } from 'next/server'

// This route is DISABLED.
//
// The canonical WhatsApp OAuth callback is: /api/whatsapp/callback
// That route is the one the start route redirects to and that is registered in
// the Meta App dashboard. This duplicate depended on an unset META_WA_REDIRECT_URI
// and was never reachable. Having two callback routes causes redirect_uri_mismatch
// errors from Meta. Do not re-enable this route.
export async function GET() {
  return new NextResponse('Gone — WhatsApp OAuth callback has moved to /api/whatsapp/callback', { status: 410 })
}
