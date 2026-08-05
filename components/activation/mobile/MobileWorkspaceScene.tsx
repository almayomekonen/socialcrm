import { SocialCrmMark } from '@/components/activation/ActivationBrand'

/**
 * The illustration for the mobile handoff screen: a single floating desktop
 * window, rendered in glass on the dark activation surface.
 *
 * The metaphor is deliberate. The previous mobile illustration
 * (ActivationBrand) showed three channels converging into the mark — an
 * *activation* message ("your leads will flow in"), which is the wrong sentence
 * on a screen whose only job is "your workspace lives on a bigger display".
 * A window silhouette says "professional desktop workspace" before a word is
 * read, and reuses the floating-card idiom already established by the marketing
 * hero rather than inventing a third visual language.
 *
 * Purely decorative: aria-hidden, so assistive tech goes straight from the
 * heading to the action. Every animation is opt-out via prefers-reduced-motion
 * (the .mh-anim class is neutralised in MobileHandoff's keyframe block).
 */

/** Abstract lead rows — width ratios only, never real or fabricated data. */
const ROWS = [
  { w: '86%', pill: true },
  { w: '64%', pill: false },
  { w: '74%', pill: false },
] as const

function Bar({ width, dim = false }: { width: string; dim?: boolean }) {
  return (
    <span
      className='block h-2 rounded-full'
      style={{ width, background: dim ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.14)' }}
    />
  )
}

export default function MobileWorkspaceScene() {
  return (
    <div className='relative mx-auto w-full' style={{ maxWidth: 'min(86vw, 320px)' }} aria-hidden='true'>
      {/* Ambient light behind the card — the warm brand glow, breathing slowly. */}
      <div
        className='mh-anim pointer-events-none absolute rounded-full'
        style={{
          inset: '-16%',
          background:
            'radial-gradient(ellipse, rgba(252,191,73,0.22) 0%, rgba(63,32,245,0.13) 45%, transparent 72%)',
          filter: 'blur(38px)',
          animation: 'mh-breathe 7s ease-in-out infinite',
        }}
      />

      {/* The workspace window. */}
      <div
        className='mh-anim relative overflow-hidden rounded-2xl'
        style={{
          background: 'rgba(255,255,255,0.045)',
          border: '1px solid rgba(255,255,255,0.10)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          boxShadow: '0 30px 70px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.10)',
          animation: 'mh-float 7s ease-in-out infinite',
        }}
      >
        {/* Title bar */}
        <div
          className='flex items-center gap-1.5 px-4 py-3'
          style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
        >
          {['rgba(255,255,255,0.20)', 'rgba(255,255,255,0.14)', 'rgba(255,255,255,0.10)'].map((c) => (
            <span key={c} className='size-2 rounded-full' style={{ background: c }} />
          ))}
        </div>

        {/* Window body: the app mark, then abstract lead rows. */}
        <div className='flex flex-col gap-4 px-4 py-5'>
          <div className='flex items-center gap-3'>
            <SocialCrmMark size={34} />
            <span className='flex flex-1 flex-col gap-1.5'>
              <Bar width='58%' />
              <Bar width='34%' dim />
            </span>
          </div>

          <div className='flex flex-col gap-3'>
            {ROWS.map((row) => (
              <div key={row.w} className='flex items-center gap-2'>
                <Bar width={row.w} dim={!row.pill} />
                {row.pill && (
                  <span
                    className='h-3.5 flex-none rounded-full'
                    style={{ width: 34, background: 'rgba(252,191,73,0.28)' }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
