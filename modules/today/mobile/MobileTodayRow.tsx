import Link from 'next/link'
import type { Route } from 'next'
import LeadContactActions from '@/modules/leads/mobile/LeadContactActions'
import type { MobileTodayRow as Row, MobileTodayTones } from './viewModel'
import { todayReasonTone, todayToneClass, todayWindowHintTone } from './reasonTone'

/**
 * One Today row: who, why, and the two fastest ways to reach them.
 *
 * ── Why this replaced `MobileListRow` + `MobileLeadCallButton` ───────────────
 *
 * `MobileListRow` renders its `trailing` slot INSIDE the row's own `<Link>`. The
 * previous Today row put a `tel:` anchor in that slot, which produced an `<a>`
 * nested inside an `<a>` — invalid HTML that the parser silently repairs by
 * closing the outer anchor early. Measured on the real screen at all four phone
 * widths, every populated Today list reported nested interactive elements. The
 * row's own docstring already forbids exactly this ("a button inside a link is a
 * broken tap target on touch and invalid nesting for assistive tech"); Today was
 * the one caller violating it.
 *
 * The fix is the structure `LeadCardMobile` already uses on the לידים list: a
 * flex wrapper whose children are the `<Link>` and the actions, as SIBLINGS.
 * Nothing is nested, both hit areas are real, and the two screens now build a row
 * the same way instead of two different ways.
 *
 * ── Why `LeadContactActions` ────────────────────────────────────────────────
 *
 * Today used to offer Call only. WhatsApp is the channel this product is built
 * around, so the row that says "act now" was missing the action reps actually
 * take. `LeadContactActions` is the shipped mobile contact cluster — it already
 * routes WhatsApp through `openLeadWhatsappInInbox` into the in-app conversation
 * (never `wa.me`, which is the fallback only when the backend cannot resolve
 * one), already records the shared analytics event, already handles the pending
 * and unreachable cases, and already measures 44px targets 50px apart. Reusing it
 * adds the action without a second WhatsApp implementation to keep in sync.
 *
 * Server Component. `reason` and `eyebrow` were computed upstream; no clock is
 * read here (architecture-rules.md §11).
 */
export default function MobileTodayRow({
  row,
  tones,
  whatsappConnected,
}: {
  row: Row
  /** Resolved from codes on the server (`MobileTodayModel.tones`). */
  tones?: MobileTodayTones
  /** Workspace WhatsApp connection — decides in-app conversation vs native handoff. */
  whatsappConnected?: boolean
}) {
  const { id, name, phone, reason, href, windowHint } = row
  // Production models carry tones resolved from codes on the server; only a
  // hand-built row without them falls back to the legacy Hebrew-text mapping.
  const reasonTone = todayToneClass(tones ? tones.tone : todayReasonTone(reason))
  const hintTone = windowHint ? todayToneClass(tones ? tones.windowTone : todayWindowHintTone(windowHint)) : null

  return (
    /* Padding lives on the Link, not this wrapper — the same lesson
       `LeadCardMobile` documents: padding on the wrapper leaves the link's own
       box under 44px while the row merely looks tall enough. */
    <div className='flex items-center gap-2.5 px-3.5'>
      <Link
        href={href as Route}
        prefetch={false}
        className='press min-w-0 flex-1 rounded py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        <span className='block truncate text-[15px] font-semibold leading-tight text-ink'>{name || '—'}</span>
        <span
          className={`mt-0.5 flex min-w-0 items-center gap-1 text-[12px] leading-tight ${
            reasonTone ? `font-medium ${reasonTone.text}` : 'text-gray-500'
          }`}
        >
          {reasonTone && <span aria-hidden className={`size-1 shrink-0 rounded-full ${reasonTone.dot}`} />}
          <span className='truncate'>{reason}</span>
        </span>
        {windowHint && (
          <span
            className={`mt-0.5 block truncate text-[11.5px] leading-tight ${
              hintTone ? hintTone.text : 'text-gray-400'
            }`}
          >
            {windowHint}
          </span>
        )}
      </Link>

      <LeadContactActions leadId={id} phone={phone} name={name}  whatsappConnected={whatsappConnected} />
    </div>
  )
}
