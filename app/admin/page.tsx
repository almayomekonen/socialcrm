import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { getUser } from '@/db/auth'
import { isPlatformOwner } from '@/lib/auth/platformOwner'
import { listAgencyTrialsForAdmin, listPendingInvitesForAdmin } from '@/db/trial'
import { getTrialState, type TrialStatus } from '@/lib/trial'
import { MapRoles } from '@/types/roles'

// Under Next's cacheComponents, uncached reads (cookies in getUser, the trial
// queries) must sit inside a Suspense boundary so they don't block the whole
// route — same pattern the (app) layout uses for LayoutContent.

const STATUS_LABEL: Record<TrialStatus, string> = {
  TRIAL_ACTIVE: 'ניסיון פעיל',
  TRIAL_EXPIRED: 'ניסיון הסתיים',
  NEVER_STARTED: 'טרם התחיל',
  PAID: 'משלם · Pro',
  LEGACY: 'גישה מלאה · Legacy',
}

// Color carries meaning only (status), per the UX rules — no decoration.
const STATUS_CLASS: Record<TrialStatus, string> = {
  TRIAL_ACTIVE: 'bg-amber-100 text-amber-800',
  TRIAL_EXPIRED: 'bg-red-100 text-red-700',
  NEVER_STARTED: 'bg-gray-100 text-gray-600',
  PAID: 'bg-green-100 text-green-700',
  LEGACY: 'bg-blue-100 text-blue-700',
}

// Sort: most time-sensitive first (active trials about to lapse), then expired,
// then the rest. Within active trials, fewest days remaining rises to the top.
const STATUS_RANK: Record<TrialStatus, number> = {
  TRIAL_ACTIVE: 0,
  TRIAL_EXPIRED: 1,
  NEVER_STARTED: 2,
  PAID: 3,
  LEGACY: 4,
}

function formatDate(value: Date | string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function AdminPage() {
  return (
    <Suspense fallback={<div className='max-w-6xl mx-auto px-4 py-10 text-gray-400'>טוען…</div>}>
      <AdminContent />
    </Suspense>
  )
}

async function AdminContent() {
  const user = await getUser()
  // Deny-by-default: anyone who is not an allowlisted platform owner gets a 404,
  // so the route's existence isn't even revealed.
  if (!user || !isPlatformOwner(user.email)) notFound()

  const now = new Date()
  const [agencyRows, invites] = await Promise.all([listAgencyTrialsForAdmin(), listPendingInvitesForAdmin()])

  // Pending invites per agency — surfaced both as a per-row count and a detail
  // section, since invited people aren't `users` yet (they have no row there).
  const invitedByAgency = new Map<number, number>()
  for (const inv of invites) invitedByAgency.set(inv.agencyId, (invitedByAgency.get(inv.agencyId) ?? 0) + 1)

  const rows = agencyRows
    .map((row) => ({ ...row, state: getTrialState(row, now), invited: invitedByAgency.get(row.agencyId) ?? 0 }))
    .sort((a, b) => {
      const rank = STATUS_RANK[a.state.status] - STATUS_RANK[b.state.status]
      if (rank !== 0) return rank
      return (a.state.daysRemaining ?? Infinity) - (b.state.daysRemaining ?? Infinity)
    })

  const totals = {
    workspaces: rows.length,
    users: rows.reduce((sum, r) => sum + r.userCount, 0),
    activeTrials: rows.filter((r) => r.state.status === 'TRIAL_ACTIVE').length,
    paying: rows.filter((r) => r.state.status === 'PAID').length,
    invited: invites.length,
  }

  return (
    <div dir='rtl' className='max-w-6xl mx-auto px-4 py-10'>
      <header className='mb-6'>
        <h1 className='text-2xl font-bold text-gray-900'>ניהול מערכת · משתמשים ומנויים</h1>
        <p className='text-sm text-gray-500 mt-1'>מצב הניסיון של כל סביבת עבודה וכמה ימים נשארו.</p>
      </header>

      <div className='grid grid-cols-2 md:grid-cols-5 gap-3 mb-8'>
        <SummaryCard label='סביבות עבודה' value={totals.workspaces} />
        <SummaryCard label='משתמשים מחוברים' value={totals.users} />
        <SummaryCard label='מוזמנים ממתינים' value={totals.invited} />
        <SummaryCard label='ניסיונות פעילים' value={totals.activeTrials} />
        <SummaryCard label='משלמים' value={totals.paying} />
      </div>

      <div className='rounded-2xl border border-gray-200 overflow-hidden bg-white'>
        <table className='w-full text-sm'>
          <thead>
            <tr className='bg-gray-50 border-b border-gray-100 text-right'>
              <Th>סביבת עבודה</Th>
              <Th>סטטוס</Th>
              <Th>ימים שנותרו</Th>
              <Th>סיום ניסיון</Th>
              <Th>משתמשים</Th>
              <Th>מוזמנים</Th>
              <Th>איש קשר</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.agencyId} className='border-t border-gray-100 hover:bg-gray-50'>
                <td className='px-4 py-3 font-semibold text-gray-900'>{r.agencyName ?? `#${r.agencyId}`}</td>
                <td className='px-4 py-3'>
                  <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_CLASS[r.state.status]}`}>
                    {STATUS_LABEL[r.state.status]}
                  </span>
                </td>
                <td className='px-4 py-3 text-gray-700'>
                  {r.state.status === 'TRIAL_ACTIVE' && r.state.daysRemaining != null ? (
                    <span className={r.state.daysRemaining <= 2 ? 'font-bold text-red-600' : 'font-medium'}>
                      {r.state.daysRemaining}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className='px-4 py-3 text-gray-500'>{formatDate(r.trialEndsAt)}</td>
                <td className='px-4 py-3 text-gray-700'>{r.userCount}</td>
                <td className='px-4 py-3 text-gray-700'>
                  {r.invited > 0 ? <span className='font-medium text-amber-700'>{r.invited}</span> : '—'}
                </td>
                <td className='px-4 py-3 text-gray-500'>
                  {r.adminName ? (
                    <div className='flex flex-col leading-tight'>
                      <span className='text-gray-900'>{r.adminName}</span>
                      <span className='text-xs'>{r.adminEmail}</span>
                    </div>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className='px-4 py-10 text-center text-gray-400'>
                  אין סביבות עבודה להצגה
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {invites.length > 0 && (
        <section className='mt-10'>
          <h2 className='text-lg font-bold text-gray-900 mb-1'>מוזמנים שטרם הצטרפו · {invites.length}</h2>
          <p className='text-sm text-gray-500 mb-4'>הוזמנו במייל אך עדיין לא השלימו הרשמה, לכן אינם נספרים כמשתמשים מחוברים.</p>
          <div className='rounded-2xl border border-gray-200 overflow-hidden bg-white'>
            <table className='w-full text-sm'>
              <thead>
                <tr className='bg-gray-50 border-b border-gray-100 text-right'>
                  <Th>שם</Th>
                  <Th>אימייל</Th>
                  <Th>תפקיד</Th>
                  <Th>סביבת עבודה</Th>
                  <Th>סטטוס</Th>
                  <Th>תוקף עד</Th>
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => {
                  const expired = inv.expiresAt != null && new Date(inv.expiresAt) < now
                  return (
                    <tr key={inv.id} className='border-t border-gray-100 hover:bg-gray-50'>
                      <td className='px-4 py-3 font-semibold text-gray-900'>{inv.name}</td>
                      <td className='px-4 py-3 text-gray-500'>{inv.email}</td>
                      <td className='px-4 py-3 text-gray-700'>{MapRoles[inv.role] ?? inv.role}</td>
                      <td className='px-4 py-3 text-gray-700'>{inv.agencyName ?? `#${inv.agencyId}`}</td>
                      <td className='px-4 py-3'>
                        <span
                          className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full ${
                            expired ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {expired ? 'פג תוקף' : 'ממתין לאישור'}
                        </span>
                      </td>
                      <td className='px-4 py-3 text-gray-500'>{formatDate(inv.expiresAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className='rounded-xl border border-gray-200 bg-white px-4 py-3'>
      <p className='text-2xl font-extrabold text-gray-900'>{value}</p>
      <p className='text-xs text-gray-500 mt-0.5'>{label}</p>
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className='px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right'>{children}</th>
}
