import { APP } from './chrome'

/**
 * The Lead Intelligence Card, rendered to match the real component
 * (`components/ai/LeadIntelligenceCard.tsx`) rather than an idealised one.
 *
 * The real card's shape, verified in code: a "תקציר חכם" header with a
 * confidence pill, a summary paragraph, key-insight bullets, a "פעולה מומלצת"
 * block (title + reason) on a right border, and a "מבוסס על:" sources footer.
 * Everything below mirrors that.
 *
 * BOUND BY THE CARE CHARTER, so the visual is too:
 *  - Every fact restates CRM history; the model does not produce a number
 *    (Law 1).
 *  - Nothing is sent without a human pressing send (Law 5.4) — the action reads
 *    "פתח טיוטה", not "נשלח".
 *  - No avatar, no assistant name, no "AI חושב…" theatre (Law 9).
 *
 * The three modes (Fast / Smart / Advanced) and the action ids
 * (`draft-followup-message`, `next-best-step`, `ask-question`) are the ones in
 * `lib/copilot/copilotResponse.ts`.
 */

export function CopilotPanel() {
  return (
    <div dir='rtl' className='p-4 text-[13px] sm:p-5' style={{ backgroundColor: APP.bg, color: APP.ink }}>
      <div className='rounded-lg border p-4' style={{ backgroundColor: APP.surface, borderColor: APP.border }}>
        <div className='mb-3 flex items-center gap-2'>
          <p className='flex items-center gap-1.5 text-[11.5px] font-semibold' style={{ color: APP.faint }}>
            <svg aria-hidden='true' viewBox='0 0 24 24' className='size-3.5' fill='none' stroke={APP.primary} strokeWidth='1.8'>
              <path d='M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8' strokeLinecap='round' />
            </svg>
            תקציר חכם
          </p>
          <span
            className='rounded-full px-2 py-0.5 text-[10.5px] font-medium'
            style={{ backgroundColor: '#f0fdf4', color: '#15803d' }}
          >
            ביטחון גבוה
          </span>
        </div>

        <p className='text-[13px] leading-relaxed'>
          דני פנה בוואטסאפ לפני שישה ימים וביקש הצעת מחיר לשיפוץ מטבח. ההצעה נשלחה, והוא ביקש לחזור אליו אחרי החג.
        </p>

        <ul className='mt-3 list-disc space-y-1.5 pe-5 text-[12.5px] leading-relaxed' style={{ color: APP.muted }}>
          <li>עברו ארבעה ימים מאז המגע האחרון.</li>
          <li>הליד ביקש במפורש שיחזרו אליו — לא סירב.</li>
        </ul>

        {/* Right border — the real card uses border-r-2 in this RTL layout. */}
        <div className='mt-4 border-e-2 pe-3' style={{ borderColor: APP.primary }}>
          <p className='mb-1 text-[11.5px] font-semibold' style={{ color: APP.faint }}>
            פעולה מומלצת
          </p>
          <p className='text-[13px] font-medium'>לחזור לדני עם הודעת המשך קצרה</p>
          <p className='mt-0.5 text-[11.5px] leading-relaxed' style={{ color: APP.faint }}>
            החג עבר והוא ביקש שיחזרו אליו אחריו.
          </p>
        </div>

        <p className='mt-4 text-[10.5px] tracking-wide' style={{ color: APP.faint }}>
          מבוסס על: שיחת וואטסאפ · היסטוריית סטטוס · תאריך מעקב
        </p>
      </div>

      {/* The Copilot actions the product actually ships. */}
      <div className='mt-3 flex flex-wrap items-center gap-2'>
        {['פתח טיוטה למעקב', 'מה הצעד הבא', 'שאל שאלה על הליד'].map((a, i) => (
          <span
            key={a}
            className='rounded-md px-2.5 py-1.5 text-[11.5px] font-medium'
            style={
              i === 0
                ? { backgroundColor: APP.primary, color: '#fff' }
                : { border: `1px solid ${APP.border}`, color: APP.muted, backgroundColor: APP.surface }
            }
          >
            {a}
          </span>
        ))}
        {/* Load-bearing sentence (care-charter Law 5.4), so it is sized and
            contrasted as real text rather than as a footnote. */}
        <span className='ms-auto text-[11.5px] font-medium' style={{ color: APP.muted }}>
          נשלח רק בלחיצה שלך
        </span>
      </div>
    </div>
  )
}
