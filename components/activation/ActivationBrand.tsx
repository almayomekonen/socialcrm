/**
 * Shared brand primitives for the dark activation surface.
 *
 * The converging-channels illustration that used to live here was retired with
 * the mobile activation flow: it said "your leads will flow in", which is an
 * onboarding promise, not the message of a screen that hands the user to their
 * computer. See components/activation/mobile/MobileWorkspaceScene.tsx.
 */
export const ACTIVATION_BG =
  'radial-gradient(ellipse 120% 80% at 50% 0%, #0c0a1f 0%, #06081a 50%, #04050f 100%)'

export function SocialCrmMark({ size = 76 }: { size?: number }) {
  return (
    <div className='relative inline-flex items-center justify-center'>
      <div
        className='absolute rounded-full animate-pulse'
        style={{
          inset: -Math.round(size * 0.45),
          background: 'radial-gradient(ellipse, rgba(252,191,73,0.45) 0%, rgba(251,146,60,0.15) 38%, transparent 70%)',
          filter: 'blur(26px)',
        }}
      />
      <div
        className='relative grid place-items-center'
        style={{
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.28),
          background: 'linear-gradient(135deg, #fefcf7 0%, #faf2dc 60%, #f5e6b8 100%)',
          boxShadow: [
            '0 18px 44px rgba(0,0,0,0.55)',
            '0 0 48px rgba(252,191,73,0.28)',
            'inset 0 1px 0 rgba(255,255,255,1)',
            'inset 0 0 0 1px rgba(255,255,255,0.5)',
          ].join(', '),
        }}
      >
        <img
          src='/media/fav.svg'
          alt='SocialCRM'
          width={Math.round(size * 0.62)}
          height={Math.round(size * 0.62)}
          style={{ width: Math.round(size * 0.62), height: Math.round(size * 0.62) }}
          draggable={false}
        />
      </div>
    </div>
  )
}
