import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

// Clears a stale/invalid `user` cookie, then sends the user to /auth.
// Server Components (getUser, layouts) cannot modify cookies — only a Route
// Handler or Server Action can — so the invalid-session cleanup that breaks
// the /dashboard <-> /auth loop happens here. Under /api/*, so the proxy
// matcher excludes it and it is never itself redirected. Mirrors /api/logout.
export async function GET() {
  const cokis = await cookies()
  cokis.delete('user')
  redirect('/auth')
}
