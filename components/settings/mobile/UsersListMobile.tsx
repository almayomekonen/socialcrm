'use client'

import { useState } from 'react'
import Icon from '@/lib/Icon'
import BottomSheet from '@/components/mobile/BottomSheet'
import MobileListRow, { MobileList } from '@/components/mobile/MobileListRow'
import { MapRoles } from '@/types/roles'
import { useRegionAttrs, useT } from '@/lib/i18n/I18nProvider'
import { dirFor } from '@/lib/i18n/config'
import { adminRoleLabel } from '@/components/agntsAndGrps/adminLabels'
import type { Translator } from '@/lib/i18n/translate'

/**
 * משתמשים on a phone — a list, not the desktop users table.
 *
 * WHAT IT REPLACED. `UsersTable` carries seventeen columns, seven of which are
 * legacy insurance goal figures, plus a column manager and a search bar. Measured
 * inside the mobile shell it rendered two real `<table>` elements — the exact
 * "desktop page inside a phone" this workspace exists to prevent.
 *
 * THE HIERARCHY IS THE POINT, not the density. A rep scanning this screen is
 * answering one of two questions: "who is on my team" and "why can't this person
 * get in". So a row shows NAME, ROLE and — only when it is true — SUSPENDED,
 * with the email underneath as the secondary line. Everything else moves into the
 * sheet, which is what keeps the row at the shared 64px rhythm instead of
 * becoming a card per person.
 *
 * READ-ONLY BY CONSTRUCTION. Creating users, editing permissions and assigning
 * teams stay on desktop: they are multi-field operations against
 * `user_perms`, and this component deliberately ships no mutation at all. The
 * sheet says so plainly rather than offering a control that would refuse.
 *
 * Reuses `MobileListRow` + `BottomSheet` — the same row rhythm and the same sheet
 * as לידים and שיחות, so Settings does not read as a different product.
 */

export type MobileUserRow = {
  id: number
  name: string
  email: string | null
  phone: string | null
  role: string | null
  suspended: boolean
}

export type MobileInvitationRow = {
  id: number
  name: string
  email: string | null
  role: string | null
  status: string | null
  expiresAt: string | null
}

/** By role CODE; Hebrew is `MapRoles` itself (as before), other languages the admin role labels. */
const roleLabel = (role: string | null, t: Translator) =>
  t.locale === 'he' ? (role && MapRoles[role as keyof typeof MapRoles]) || role || '—' : (role && adminRoleLabel(role, t.locale)) || role || '—'

function Chip({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'warn' }) {
  const cls =
    tone === 'warn'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-gray-200 bg-gray-50 text-gray-600'
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>
}

export default function UsersListMobile({
  users,
  invitations,
}: {
  users: MobileUserRow[]
  invitations: MobileInvitationRow[]
}) {
  const t = useT()
  const region = useRegionAttrs()
  const [selected, setSelected] = useState<MobileUserRow | null>(null)

  return (
    <div className='pb-4' {...region}>
      <Section title={t('admin.mobile.users.title')} count={users.length} />

      {users.length === 0 ? (
        <Empty text={t('admin.mobile.users.noUsers')} />
      ) : (
        <MobileList className='border-y border-gray-200 bg-white'>
          {users.map((u) => (
            <MobileListRow
              translated
              key={u.id}
              onClick={() => setSelected(u)}
              title={u.name || u.email || t('admin.mobile.users.userFallback', { id: String(u.id) })}
              subtitle={u.email ?? undefined}
              badges={
                <>
                  <Chip label={roleLabel(u.role, t)} />
                  {/* Shown only when true — a "פעיל" chip on every row is noise
                      that makes the one suspended user harder to spot. */}
                  {u.suspended && <Chip label={t('admin.mobile.users.suspended')} tone='warn' />}
                </>
              }
            />
          ))}
        </MobileList>
      )}

      <Section title={t('admin.mobile.users.invitations')} count={invitations.length} />

      {invitations.length === 0 ? (
        <Empty text={t('admin.mobile.users.noInvitations')} />
      ) : (
        <MobileList className='border-y border-gray-200 bg-white'>
          {invitations.map((i) => (
            <MobileListRow
              translated
              key={i.id}
              title={i.name || i.email || t('admin.mobile.users.invitationFallback', { id: String(i.id) })}
              subtitle={i.email ?? undefined}
              meta={i.expiresAt ?? undefined}
              badges={
                <>
                  <Chip label={roleLabel(i.role, t)} />
                  {i.status && <Chip label={i.status} />}
                </>
              }
              /* No chevron and no onClick: an invitation has nothing further to
                 show and nothing to do here. A row that opens an empty sheet is
                 worse than a row that plainly does not move. */
              trailing={<span />}
            />
          ))}
        </MobileList>
      )}

      <BottomSheet open={selected !== null} onClose={() => setSelected(null)} title={selected?.name || t('admin.mobile.users.user')} translated>
        {selected && (
          <div className='flex flex-col gap-1'>
            <DetailRow label={t('admin.mobile.users.role')} value={roleLabel(selected.role, t)} />
            <DetailRow label={t('admin.mobile.users.email')} value={selected.email} href={selected.email ? `mailto:${selected.email}` : null} />
            <DetailRow label={t('admin.mobile.users.phone')} value={selected.phone} href={selected.phone ? `tel:${selected.phone}` : null} />
            <DetailRow label={t('admin.mobile.users.status')} value={selected.suspended ? t('admin.mobile.users.suspended') : t('admin.mobile.users.active')} />

            <p className='mt-3 border-t border-gray-100 pt-3 text-[12px] leading-relaxed text-gray-500'>
              {t('admin.mobile.users.desktopNote')}
            </p>
          </div>
        )}
      </BottomSheet>
    </div>
  )
}

function Section({ title, count }: { title: string; count: number }) {
  return (
    <div className='flex items-baseline justify-between px-4 pb-1.5 pt-5'>
      <h2 className='text-[13px] font-semibold text-gray-500'>{title}</h2>
      <span className='text-[12px] tabular-nums text-gray-400'>{count}</span>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className='border-y border-gray-200 bg-white px-4 py-6 text-center text-[13px] text-gray-500'>{text}</p>
}

/**
 * `mailto:`/`tel:` become real anchors so the OS can act on them; everything
 * else is inert text. A row that looks tappable and does nothing is the defect
 * this avoids.
 */
function DetailRow({ label, value, href }: { label: string; value: string | null; href?: string | null }) {
  const t = useT()
  if (!value) return null
  const body = (
    <>
      <span className='shrink-0 text-[12px] text-gray-400'>{label}</span>
      <span className='truncate text-[14px] text-ink' dir={href?.startsWith('tel:') ? 'ltr' : undefined}>
        {value}
      </span>
    </>
  )
  if (href) {
    return (
      <a
        href={href}
        className='press flex min-h-11 items-center justify-between gap-3 rounded-md px-1 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        {body}
        <Icon name='angle-left' type='sol' className='size-3.5 shrink-0 bg-gray-300' flip={dirFor(t.locale) === 'ltr'} />
      </a>
    )
  }
  return <div className='flex min-h-11 items-center justify-between gap-3 px-1'>{body}</div>
}
