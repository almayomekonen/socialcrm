import { NextResponse } from 'next/server'

// This route is DISABLED.
//
// The canonical OAuth callback is: /api/auth/facebook/callback
// That route is registered in META_REDIRECT_URI and in the Facebook App dashboard.
//
// Having two active callback routes with different redirect_uri values causes
// token exchange failures due to redirect_uri_mismatch errors from Meta.
// Do not re-enable this route.
export async function GET() {
  return new NextResponse('Gone — OAuth callback has moved to /api/auth/facebook/callback', { status: 410 })
}
