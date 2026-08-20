import Icon from '@/lib/Icon'
import { isAdmin } from '@/types/roles'
import type { Roles } from '@/types/roles'
import { getMasterEnabled, getChannelSettings } from '@/db/autoResponseSettings'
import AutoResponseToggle from './AutoResponseToggle'

/**
 * מענה אוטומטי, on a phone: is it on, what does it say, and how to stop it.
 *
 * NOT THE DESKTOP FORM. That form owns seven fields — daily cap, delay, guidance,
 * reply mode, fixed body, channel and master — because configuring an automatic
 * responder is desk work. The phone gets the one thing that is genuinely urgent
 * away from a computer: the ability to see that a machine is messaging customers
 * and to stop it. Everything else is read-only here and stated to live on the
 * computer, so this screen can never drift into a second settings surface.
 *
 * Server Component: two existing reads (`getMasterEnabled`, `getChannelSettings`),
 * no new query, no polling, no cache layer. The only mutation on this screen is
 * the master switch, through its own narrow action.
 *
 * ADMIN ONLY, TWICE. The `(admin_settings)` layout already blocks non-ADMIN
 * before this renders, and the server action checks again on every call. The
 * check below is the third: it keeps the guarantee attached to the component
 * itself, so mounting it from a future route cannot quietly drop the gate.
 */
export default async function AutoResponseMobile({
  agencyId,
  role,
}: {
  agencyId: number
  role: Roles
}) {
  if (!isAdmin(role)) {
    return (
      <div className='px-4 py-10 text-center'>
        <p className='text-sm text-gray-500'>אין לך הרשאה לצפות בדף זה</p>
      </div>
    )
  }

  const [master, channel] = await Promise.all([getMasterEnabled(agencyId), getChannelSettings(agencyId, 'whatsapp')])

  const replyMode = channel?.replyMode ?? 'ai'
  const fixedBody = channel?.fixedBody?.trim() || null
  const guidance = channel?.guidance?.trim() || null
  // Master on but the WhatsApp channel off means nothing is actually sent.
  // Saying "פעיל" then would be a false statement about the business, so the
  // gap is named here rather than papered over (care-charter Laws 1-3).
  const channelOff = master && !(channel?.enabled ?? false)

  return (
    <div className='flex flex-col gap-4 px-4 pb-8 pt-3'>
      <AutoResponseToggle initialEnabled={master} />

      {channelOff && (
        <p className='rounded-xl border border-warning-border bg-warning-bg px-3.5 py-3 text-[13px] leading-relaxed text-warning-text'>
          ערוץ הוואטסאפ כבוי, כך שגם כשהמענה האוטומטי פעיל לא נשלחות הודעות. אפשר להפעיל אותו מהמחשב.
        </p>
      )}

      <section aria-labelledby='auto-response-message' className='flex flex-col gap-2'>
        <h2 id='auto-response-message' className='px-1 text-sm font-semibold text-gray-500'>
          ההודעה שנשלחת
        </h2>

        <div className='rounded-xl border border-gray-200 bg-white px-3.5 py-3'>
          {replyMode === 'fixed' ? (
            fixedBody ? (
              /* The stored text, verbatim. Nothing is generated or previewed
                 here — this is the exact נוסח the desktop form saved. */
              <p className='whitespace-pre-wrap text-[15px] leading-relaxed text-ink'>{fixedBody}</p>
            ) : (
              <p className='text-[15px] leading-relaxed text-gray-500'>עדיין לא הוגדרה הודעה קבועה.</p>
            )
          ) : (
            <>
              <div className='flex items-center gap-2'>
                <Icon type='sol' name='sparkles' className='size-4 bg-primary' />
                <p className='text-[15px] font-medium text-ink'>מענה חכם</p>
              </div>
              <p className='mt-1 text-[13px] leading-relaxed text-gray-500'>
                כל תשובה נכתבת לפי ההודעה שהתקבלה, כך שאין נוסח קבוע להצגה.
              </p>
              {guidance && (
                <div className='mt-3 border-t border-gray-100 pt-3'>
                  <p className='text-[12px] font-medium text-gray-500'>על העסק שלכם</p>
                  <p className='mt-1 whitespace-pre-wrap text-[15px] leading-relaxed text-ink'>{guidance}</p>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* The handoff sentence, matching the copy contract the rest of the
          mobile workspace uses for desk work (lib/mobile/desktopOnlyRoutes.ts):
          state where it lives, never apologise, never frame it as missing. */}
      <p className='px-1 text-[13px] leading-relaxed text-gray-500'>
        הגדרות מתקדמות זמינות מהמחשב.
      </p>
    </div>
  )
}
