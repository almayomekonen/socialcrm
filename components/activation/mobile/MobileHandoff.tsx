import { ACTIVATION_BG } from '@/components/activation/ActivationBrand'
import MobileWorkspaceScene from '@/components/activation/mobile/MobileWorkspaceScene'
import ContinueOnDesktop from '@/components/activation/mobile/ContinueOnDesktop'
import { handoffCopyIn } from '@/lib/activation/localizedCopy'
import { rtlOrRegionAttrs } from '@/lib/i18n/preLoginLocale'
import type { UiLocale } from '@/lib/i18n/config'

/**
 * The mobile experience for SocialCRM — the entire experience, not a fallback.
 *
 * SocialCRM is a desktop workspace by product decision, with a native mobile
 * app on the roadmap. This screen states that plainly and hands the user to
 * their computer. It is not an activation wall, not an error page, and not a
 * dead end: there is exactly one state, and it contains a working action.
 *
 * What it replaced: the mobile branch of ActivationExperience, which rendered
 * the Facebook activation FSM to anyone without a facebook_pages row. Once
 * onboarding stopped requiring Facebook, that meant a business which onboarded
 * by importing a spreadsheet opened the app on a phone and was told to connect
 * Facebook to start receiving leads — the wrong product, in the wrong moment,
 * with no way out. There is no branching here at all.
 *
 * Rendered ONLY when the server has already determined this is a phone
 * (app/activate/page.tsx → isMobileRequest). Per architecture-rules.md §9 a
 * mobile-only surface is gated by absence, never CSS-hidden on desktop — the
 * rule names this exact screen as its example.
 */

/**
 * Scoped to this screen (mh- prefix) and injected here rather than in main.css
 * so the whole experience stays in one module. `mh-rise` is the staggered
 * entrance; `mh-float` / `mh-breathe` are the ambient loops on the scene.
 *
 * The reduced-motion block is a hard kill-switch, not a softening: it removes
 * the animations entirely and pins the entrance to its final state, so nothing
 * depends on an animation having run.
 */
const KEYFRAMES = `
@keyframes mh-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-9px) } }
@keyframes mh-breathe { 0%,100% { opacity: .62; transform: scale(1) } 50% { opacity: 1; transform: scale(1.05) } }
@keyframes mh-rise { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: none } }
.mh-rise { opacity: 0; animation: mh-rise 420ms cubic-bezier(0.32,0.72,0,1) forwards; }
@media (prefers-reduced-motion: reduce) {
  .mh-anim { animation: none !important; }
  .mh-rise { animation: none !important; opacity: 1 !important; transform: none !important; }
}
`

/** `locale`: the pre-login interface language (Phase F4); Hebrew by default. */
export default function MobileHandoff({ locale = 'he' }: { locale?: UiLocale }) {
  const COPY = handoffCopyIn(locale)
  return (
    <main
      {...rtlOrRegionAttrs(locale)}
      className='flex min-h-dvh w-full flex-col items-center justify-center gap-9 overflow-x-hidden px-6'
      style={{
        background: ACTIVATION_BG,
        // Respect the notch and the home indicator rather than sitting under them.
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 2.5rem)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 2.5rem)',
      }}
    >
      <style>{KEYFRAMES}</style>

      <div className='mh-rise w-full' style={{ animationDelay: '40ms' }}>
        <MobileWorkspaceScene />
      </div>

      <div className='mh-rise flex w-full max-w-[340px] flex-col items-center gap-3 text-center' style={{ animationDelay: '130ms' }}>
        <h1 className='text-[26px] font-bold leading-tight text-white'>{COPY.heading}</h1>
        <p className='text-[14px] leading-[1.75] text-white/60'>{COPY.body}</p>
      </div>

      <div className='flex w-full max-w-[340px] flex-col items-center'>
        <ContinueOnDesktop />
      </div>

      <div className='mh-rise flex w-full max-w-[340px] flex-col items-center gap-3' style={{ animationDelay: '300ms' }}>
        <span aria-hidden='true' className='h-px w-full' style={{ background: 'rgba(255,255,255,0.08)' }} />
        <p className='text-[12px] tracking-wide text-white/45'>{COPY.soonLabel}</p>
        {/*
          The ONLY Support entry point reachable on a phone. The (app) layout
          redirects every phone here, so the settings nav link can never be
          seen on mobile — without this, a customer on a phone whose WhatsApp
          just broke has no way to reach us at all. /support sits outside the
          (app) redirect and renders fine on 390px.
        */}
        <a href='/support' className='text-[12px] text-white/60 underline-offset-4 hover:underline'>
          {COPY.supportLink}
        </a>
      </div>
    </main>
  )
}
