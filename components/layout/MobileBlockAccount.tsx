import { getUser } from '@/db/auth'

/** Presentational card — glass language matches the MobileBlock checklist. */
export function AccountCard({ email }: { email: string }) {
  return (
    <div
      className='mt-3 px-6 py-3 rounded-2xl text-center mb-fade-up-d2'
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        backdropFilter: 'blur(20px)',
      }}
    >
      <p className='text-[11px] text-white/45'>מחובר כעת:</p>
      <p className='mt-0.5 text-[13px] font-medium text-white/85' dir='ltr'>
        {email}
      </p>
    </div>
  )
}

/**
 * Streams the authenticated user's email into the MobileBlock overlay.
 * Lives outside the app's UserProvider (the overlay renders before the
 * layout's Suspense resolves), so it reads the session itself. Renders
 * nothing if the session is missing — never blocks or breaks the overlay.
 */
export default async function MobileBlockAccount() {
  const user = await getUser().catch(() => null)
  if (!user?.email) return null
  return <AccountCard email={user.email} />
}
