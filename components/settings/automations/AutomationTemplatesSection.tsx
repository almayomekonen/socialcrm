'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Icon from '@/lib/Icon'
import { TEMPLATE_CATEGORIES, type TemplateCategory } from '@/lib/automations/templates/types'
import type { TemplateView } from '@/lib/automations/templates/overview'
import AutomationTemplateCard from './AutomationTemplateCard'
import TemplateInstallDialog from '@/components/settings/templates/TemplateInstallDialog'

const CATEGORY_LABEL: Record<TemplateCategory, string> = {
  lead: 'לידים',
  appointment: 'פגישות',
  form: 'טפסים',
  internal: 'צוות',
}

export default function AutomationTemplatesSection({
  views,
  query,
  onQueryChange,
  onCreate,
}: {
  views: TemplateView[]
  /** Shared with the control centre: one search box filters both surfaces. */
  query: string
  onQueryChange: (next: string) => void
  onCreate: () => void
}) {
  const router = useRouter()
  const [category, setCategory] = useState<TemplateCategory | 'all'>('all')
  const [installing, setInstalling] = useState<TemplateView | null>(null)

  const available = useMemo(() => views.filter((v) => v.installed === 0), [views])

  /** Only categories that actually have something in them — never a dead tab. */
  const tabs = useMemo(() => {
    const present = new Set(available.map((v) => v.template.category))
    return TEMPLATE_CATEGORIES.filter((c) => present.has(c))
  }, [available])

  const q = query.trim().toLowerCase()
  const shown = useMemo(
    () =>
      available.filter((v) => {
        if (category !== 'all' && v.template.category !== category) return false
        if (!q) return true
        return `${v.template.title} ${v.template.description}`.toLowerCase().includes(q)
      }),
    [available, category, q],
  )

  /** Said plainly, because a count the eye can verify beats a silent filter. */
  const hiddenByCategory = category === 'all' ? 0 : available.length - shown.length

  return (
    /*
     * A CONTAINER query, not a media query. The Copilot column opens and closes
     * without the viewport changing by a pixel, so `lg:` and friends would keep
     * three tracks in a space that now holds two. The grid reacts to the width
     * it actually has.
     *
     * A size query measures the CONTENT box, so these thresholds are the grid's
     * own width with the padding below already taken off. Three tracks wait for
     * 896px because that is where they clear ~298px each, against the ~282px the
     * cards were drawn at; at 768 they would be ~255px.
     *
     * `pt-6` is the shared settings top offset, the same 24px every other page
     * gets from the chrome. It lives here rather than on the content cell so the
     * control centre beside it can stay a full-height column (see SettingsChrome),
     * and it is the same value there, so both panes start on one line. The
     * concept's 64px was drawn for a screen that owned the whole window.
     *
     * THE TWO SIDES ARE NOT EQUAL, and that is the point. `pe-14` is the gutter
     * to the control centre, drawn at 56px. `ps-6` is 24px because the settings
     * grid gives אוטומציות a 24px gutter where other pages get 48px — 24 + 24
     * lands the h1 on exactly the same line as פרטי העסק and אינטגרציות, which
     * inset their content by nothing at all. Symmetric padding here is what put
     * the whole page 32px out of step with the rest of settings.
     */
    <section className='@container/lib flex min-w-0 flex-1 flex-col pe-14 ps-6 pt-6 mobile:pe-5 mobile:ps-5 mobile:pt-8'>
      {/*
        `title` and the gray-600 paragraph under it are the settings page header,
        copied from אינטגרציות rather than restyled: 24px semibold, 8px to the
        subtitle, 32px to the content. The concept's 38px hero was sized for a
        screen that owned the window; at settings scale it just shouted over the
        nav beside it.
      */}
      <div className='flex items-start justify-between gap-10 pb-8'>
        <div className='flex min-w-0 flex-col gap-2'>
          <h1 className='title'>ספריית האוטומציות</h1>
          <p className='max-w-2xl text-sm leading-relaxed text-gray-600'>
            התקינו יכולת אחת, והיא רצה מכאן והלאה בלי שתצטרכו לגעת בה.
          </p>
        </div>

        <div className='flex flex-none items-center gap-2.5'>
          <div className='relative'>
            <Icon
              name='magnifying-glass'
              type='reg'
              className='pointer-events-none absolute top-1/2 size-3.75 -translate-y-1/2 bg-[#b6bfcc] end-3.5'
            />
            <input
              type='search'
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder='חיפוש'
              aria-label='חיפוש תבניות ואוטומציות'
              className='h-9 w-52 rounded-[9px] bg-white ps-3.5 pe-9 text-[13.5px] text-ink shadow-[0_0_0_1px_rgba(16,24,64,.05),0_1px_2px_rgba(16,24,64,.05)] outline-none transition-shadow duration-150 placeholder:text-[#98a3b8] hover:shadow-[0_0_0_1px_rgba(16,24,64,.1),0_2px_6px_rgba(16,24,64,.07)] focus:shadow-[0_0_0_1px_var(--color-primary)]'
            />
          </div>

          <button
            type='button'
            onClick={onCreate}
            className='flex h-9 flex-none items-center rounded-[9px] bg-ink px-3.75 text-[13.5px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,.12),0_1px_2px_rgba(10,37,64,.28)] transition-transform duration-100 active:translate-y-px'
          >
            אוטומציה חדשה
          </button>
        </div>
      </div>

      {tabs.length > 1 && (
        <div className='mb-6 flex items-center gap-1 self-start rounded-[10px] bg-[#eeeff2] p-0.75'>
          <Tab active={category === 'all'} onClick={() => setCategory('all')}>
            הכול
          </Tab>
          {tabs.map((c) => (
            <Tab key={c} active={category === c} onClick={() => setCategory(c)}>
              {CATEGORY_LABEL[c]}
            </Tab>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <p className='rounded-[14px] px-2 py-16 text-center text-[14px] text-[#aab3c0] shadow-[0_0_0_1px_rgba(16,24,64,.05)]'>
          {available.length === 0
            ? 'כל התבניות כבר מותקנות אצלכם.'
            : 'אין תבנית שמתאימה לחיפוש. נסו מילה אחרת או קטגוריה אחרת.'}
        </p>
      ) : (
        <div className='grid grid-cols-1 gap-px overflow-hidden rounded-[14px] bg-border shadow-[0_0_0_1px_rgba(16,24,64,.05),0_1px_1px_rgba(16,24,64,.04)] @lg/lib:grid-cols-2 @4xl/lib:grid-cols-3'>
          {shown.map((view) => (
            <AutomationTemplateCard
              key={view.template.key}
              view={view}
              onInstall={() => {
                // A locked template's only useful action is fixing what it needs.
                const locked = view.availability.state === 'locked' ? view.availability.requirement : null
                if (locked?.cta) return router.push(locked.cta.href as never)
                setInstalling(view)
              }}
            />
          ))}
        </div>
      )}

      {hiddenByCategory > 0 && (
        <p className='px-0.5 py-6 text-[14px] text-[#aab3c0]'>
          עוד {hiddenByCategory} תבניות בקטגוריות שלא נבחרו
        </p>
      )}

      {installing && (
        <TemplateInstallDialog
          view={installing}
          onClose={() => setInstalling(null)}
          onDone={() => {
            setInstalling(null)
            router.refresh()
          }}
        />
      )}
    </section>
  )
}

/** The segmented control's chip. White and lifted when active, flat when not. */
function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type='button'
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-[7px] px-3.75 py-1.75 text-[13.5px] transition-colors duration-150 ${
        active
          ? 'bg-white font-semibold text-ink shadow-[0_0_0_1px_rgba(16,24,64,.04),0_1px_2px_rgba(16,24,64,.06)]'
          : 'text-[#8b98a8] hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}
