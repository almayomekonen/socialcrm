import MobileSectionHandoff from '@/components/mobile/MobileSectionHandoff'

/**
 * The workspace has no leads at all — the mobile first-run state.
 *
 * Desktop redirects to `/leads` here and renders `LeadsFirstRun` (four action
 * cards: WhatsApp, Facebook/Instagram, add, import). Mobile cannot yet: adding a
 * lead is Phase 8 and importing is Phase 9, and `/leads` on a phone is currently
 * the Phase 2 handoff — redirecting there would make "not here yet" the literal
 * first thing a new mobile user sees.
 *
 * So this offers the one first-run action that IS fully real on a phone today:
 * connecting a lead source. `/settings/integrations` is an existing route, and
 * connecting WhatsApp or Meta is exactly the step that makes leads start
 * arriving on their own — which is the whole promise the user signed up for.
 *
 * ux-guidelines.md §4: says what happened, why it matters, and what to do next.
 * Never a blank screen, never a dead end.
 */
export default function MobileTodayEmpty() {
  return (
    <MobileSectionHandoff
      icon='plug'
      title='עוד אין לידים במערכת'
      body='חברו את וואטסאפ או את פייסבוק ואינסטגרם, וכל ליד חדש יגיע לכאן אוטומטית. ייבוא מאקסל והוספה ידנית זמינים במחשב.'
      action={{ href: '/settings/integrations', label: 'חבר מקור לידים' }}
    />
  )
}
