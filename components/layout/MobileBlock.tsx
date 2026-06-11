'use client'

import { useState } from 'react'
import { copyToClipboard } from '@/lib/clipboard'

const BACKDROP_ROWS = [
  { name: 'דני לוי', status: 'סגור', color: 'green', source: 'פייסבוק' },
  { name: 'מיכל אברהם', status: 'בטיפול', color: 'blue', source: 'אינסטגרם' },
  { name: 'אבי שרון', status: 'ממתין', color: 'yellow', source: 'וואטסאפ' },
  { name: 'שרה פרץ', status: 'חדש', color: 'blue', source: 'פייסבוק' },
  { name: 'נועם ביטון', status: 'אבוד', color: 'gray', source: 'וואטסאפ' },
  { name: 'יוסי כהן', status: 'בטיפול', color: 'blue', source: 'פייסבוק' },
]

const BACKDROP_DOT: Record<string, string> = {
  green: 'bg-emerald-400/50',
  blue: 'bg-blue-400/50',
  yellow: 'bg-yellow-400/50',
  gray: 'bg-gray-500/50',
}

export default function MobileBlock() {
  return (
    <div
      dir='rtl'
      className='mb-lock fixed inset-0 z-9999 overflow-hidden desktop:hidden'
      style={{
        background:
          'radial-gradient(ellipse 120% 80% at 50% 0%, #0c0a1f 0%, #06081a 50%, #04050f 100%)',
        touchAction: 'none',
        overscrollBehavior: 'none',
      }}
      aria-hidden='false'
      role='dialog'
      aria-label='SocialCRM נבנה למחשב'
    >
      <CinematicLighting />
      <AtmosphericProductLayers />
      <Vignette />

      {/* Centered cinematic cluster — entire composition lives as one
          shrink-wrapped block at the true center of the viewport. `dvh`
          handles iOS URL-bar shrink; `justify-center` decouples the cluster
          from top/bottom edges so notch/home-indicator areas can't intrude.
          Safe-area insets are applied as padding guards for landscape edge
          cases, but they never displace the cluster off-center. */}
      <div
        className='relative z-10 w-full flex flex-col items-center justify-center h-dvh px-6 text-center'
        style={{
          paddingTop: 'max(env(safe-area-inset-top), 1rem)',
          paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)',
        }}
      >
        <HeroLogo />

        <h1
          className='mt-9 text-[44px] font-bold leading-[1.05] tracking-tight mb-fade-up-d1'
          style={{
            background:
              'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(255,235,200,0.92) 65%, rgba(252,191,73,0.85) 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
            textShadow: '0 4px 30px rgba(252,191,73,0.25)',
          }}
        >
          נבנה למחשב.
        </h1>

        <p className='mt-3 max-w-[320px] text-[14px] leading-[1.6] text-white/55 mb-fade-up-d2'>
          SocialCRM מעניק את חוויית העבודה המלאה מהמחשב.
        </p>

        <div className='mt-10 flex flex-col items-center gap-3 mb-fade-up-d3'>
          <DesktopChip />
          <CopyLinkButton />
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────────── Atmospheric layers ───────────────────────── */

/**
 * Two large soft-blurred lights — warm amber from the top-right (the "sun"
 * of the composition) and a cool indigo wash from the bottom-left. Plus a
 * faint center-bloom that pools behind the logo. Drift slowly to give the
 * scene the feeling of a living environment without ever being noticeable.
 */
function CinematicLighting() {
  return (
    <>
      <div
        className='absolute -top-32 -right-24 size-[640px] rounded-full blur-[110px] mb-drift-slow'
        style={{
          background:
            'radial-gradient(circle, rgba(252,191,73,0.32) 0%, rgba(251,146,60,0.14) 40%, transparent 70%)',
        }}
      />
      <div
        className='absolute -bottom-40 -left-32 size-[560px] rounded-full blur-[100px] mb-drift-slow-2'
        style={{
          background: 'radial-gradient(circle, color-mix(in srgb, var(--color-primary) 28%, transparent) 0%, transparent 70%)',
        }}
      />
      <div
        className='absolute top-1/3 left-1/2 -translate-x-1/2 size-[420px] rounded-full blur-[80px]'
        style={{
          background: 'radial-gradient(circle, rgba(252,191,73,0.16) 0%, transparent 70%)',
        }}
      />
    </>
  )
}

function AtmosphericProductLayers() {
  return (
    <>
      <div
        aria-hidden='true'
        className='pointer-events-none absolute -top-6 -right-10 w-[78%] max-w-[420px] origin-top-right rotate-[-4deg] mb-drift-slow'
        style={{ opacity: 0.06, filter: 'blur(2px)' }}
      >
        <div
          className='rounded-2xl overflow-hidden'
          style={{ border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.02)' }}
        >
          <div
            className='grid grid-cols-[1fr_72px_56px] gap-2 px-3 py-2.5 text-[10px] font-medium text-white/40'
            style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
          >
            <span className='text-center'>שם ליד</span>
            <span className='text-center'>סטטוס</span>
            <span className='text-center'>מקור</span>
          </div>
          {BACKDROP_ROWS.map((row, i) => (
            <div
              key={i}
              className='grid grid-cols-[1fr_72px_56px] gap-2 px-3 py-2.5 items-center'
              style={{
                borderBottom: i < BACKDROP_ROWS.length - 1 ? '1px solid rgba(255,255,255,0.05)' : undefined,
              }}
            >
              <div className='flex items-center gap-1.5 min-w-0'>
                <span className={`size-1.5 rounded-full flex-none ${BACKDROP_DOT[row.color]}`} />
                <span className='text-white/70 text-xs truncate'>{row.name}</span>
              </div>
              <span className='text-center text-white/40 text-[10px]'>{row.status}</span>
              <span className='text-white/30 text-[10px] text-left'>{row.source}</span>
            </div>
          ))}
        </div>
      </div>

      <div
        aria-hidden='true'
        className='pointer-events-none absolute -bottom-4 -left-10 w-[60%] max-w-[300px] origin-bottom-left rotate-6 mb-drift-slow-2'
        style={{ opacity: 0.05, filter: 'blur(2.5px)' }}
      >
        <ChartCardSilhouette />
      </div>
    </>
  )
}

function ChartCardSilhouette() {
  return (
    <div
      className='rounded-2xl p-4'
      style={{ border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)' }}
    >
      <div className='mb-3 flex items-center justify-between'>
        <div className='h-2 w-20 rounded bg-white/30' />
        <div className='h-2 w-10 rounded bg-white/20' />
      </div>
      <svg viewBox='0 0 200 80' className='w-full h-16' aria-hidden='true'>
        <path
          d='M 0 60 Q 30 40, 50 45 T 100 25 T 150 35 T 200 18'
          fill='none'
          stroke='rgba(252,191,73,0.55)'
          strokeWidth='2'
        />
        <path
          d='M 0 60 Q 30 40, 50 45 T 100 25 T 150 35 T 200 18 L 200 80 L 0 80 Z'
          fill='rgba(252,191,73,0.12)'
        />
      </svg>
      <div className='mt-3 flex gap-2'>
        <div className='h-1.5 flex-1 rounded bg-white/20' />
        <div className='h-1.5 w-6 rounded bg-white/15' />
      </div>
    </div>
  )
}

function Vignette() {
  return (
    <div
      aria-hidden='true'
      className='pointer-events-none absolute inset-0'
      style={{
        background:
          'radial-gradient(ellipse 90% 70% at 50% 50%, transparent 35%, rgba(0,0,0,0.45) 75%, rgba(0,0,0,0.7) 100%)',
      }}
    />
  )
}

/* ───────────────────────────── Hero logo ────────────────────────────────── */

function HeroLogo() {
  return (
    <div className='relative inline-flex items-center justify-center mb-fade-up'>
      {/* Warm halo bloom — large, soft, breathing. Sized off the square plate
          so the falloff stays radial regardless of viewport. */}
      <div
        className='absolute -inset-28 rounded-full mb-halo-breathe'
        style={{
          background:
            'radial-gradient(ellipse, rgba(252,191,73,0.5) 0%, rgba(251,146,60,0.18) 35%, transparent 70%)',
          filter: 'blur(44px)',
        }}
      />

      {/* Orbital rings — square plate means the rings can be evenly inset
          on all sides for a true circular orbit feel. */}
      <OrbitalRing className='absolute -inset-20 mb-orbit' sweep='gold' radius='84px' />
      <OrbitalRing className='absolute -inset-10 mb-orbit-rev' sweep='white' radius='60px' />

      {/* Ambient inner glow that pools directly behind the plate. */}
      <div
        className='absolute inset-[-14px] rounded-[44px]'
        style={{
          background:
            'radial-gradient(ellipse at 50% 50%, rgba(254,231,156,0.4) 0%, transparent 70%)',
          filter: 'blur(16px)',
        }}
      />

      {/* Squircle app-icon plate — sized as a luxury OS-style icon (~140px)
          so the mark inside reads as iconic, not as a chip. */}
      <div
        className='relative size-[140px] rounded-[36px] flex items-center justify-center'
        style={{
          background: 'linear-gradient(135deg, #fefcf7 0%, #faf2dc 60%, #f5e6b8 100%)',
          boxShadow: [
            '0 30px 70px rgba(0,0,0,0.6)',
            '0 0 80px rgba(252,191,73,0.3)',
            'inset 0 1px 0 rgba(255,255,255,1)',
            'inset 0 -2px 0 rgba(252,191,73,0.18)',
            'inset 0 0 0 1px rgba(255,255,255,0.5)',
          ].join(', '),
        }}
      >
        <img src='/media/fav.svg' alt='SocialCRM' width={96} height={96} className='size-24 block' draggable={false} />
      </div>
    </div>
  )
}

/**
 * A thin orbital ring with a sweeping highlight that rotates around it.
 * The ring is created via a conic-gradient (angular sweep) + radial-gradient
 * mask (carves the ring annulus out of the filled circle).
 *
 * `sweep`:
 *   'gold'  — outer ring, warm metallic glint
 *   'white' — inner ring, cooler highlight that contrasts the gold
 */
function OrbitalRing({
  className,
  sweep,
  radius,
}: {
  className?: string
  sweep: 'gold' | 'white'
  radius: string
}) {
  const sweepColor =
    sweep === 'gold'
      ? 'conic-gradient(from 0deg, rgba(252,191,73,0) 0deg, rgba(252,191,73,0) 200deg, rgba(252,191,73,0.7) 280deg, rgba(254,231,156,0.95) 305deg, rgba(252,191,73,0.7) 330deg, rgba(252,191,73,0) 360deg)'
      : 'conic-gradient(from 0deg, rgba(255,255,255,0) 0deg, rgba(255,255,255,0) 130deg, rgba(255,255,255,0.35) 200deg, rgba(255,255,255,0.55) 220deg, rgba(255,255,255,0.35) 240deg, rgba(255,255,255,0) 360deg)'

  const mask = `radial-gradient(circle, transparent calc(${radius} - 1px), black calc(${radius} - 1px), black ${radius}, transparent calc(${radius} + 1px))`

  return (
    <div
      aria-hidden='true'
      className={`pointer-events-none rounded-full ${className ?? ''}`}
      style={{
        background: sweepColor,
        WebkitMask: mask,
        mask: mask,
      }}
    />
  )
}

/* ───────────────────────────── Bottom CTA ───────────────────────────────── */

function DesktopChip() {
  return (
    <div
      className='inline-flex items-center gap-3 px-4 py-2.5 rounded-2xl'
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        backdropFilter: 'blur(20px)',
      }}
    >
      <MonitorIcon />
      <span className='text-[13px] text-white/70'>פתחו מהמחשב לחוויה המלאה</span>
    </div>
  )
}

function MonitorIcon() {
  return (
    <div
      className='size-7 rounded-lg grid place-items-center flex-none'
      style={{
        background: 'linear-gradient(135deg, rgba(252,191,73,0.22) 0%, rgba(251,146,60,0.12) 100%)',
        border: '1px solid rgba(252,191,73,0.35)',
      }}
    >
      <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='#fcd34d' strokeWidth='2'>
        <rect x='2' y='3' width='20' height='14' rx='2' />
        <line x1='8' y1='21' x2='16' y2='21' />
        <line x1='12' y1='17' x2='12' y2='21' />
      </svg>
    </div>
  )
}

function CopyLinkButton() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')

  async function handleCopy() {
    if (status === 'loading') return
    setStatus('loading')
    const ok = await copyToClipboard(window.location.href)
    setStatus(ok ? 'success' : 'error')
    setTimeout(() => setStatus('idle'), 2500)
  }

  const label =
    status === 'success'
      ? 'הקישור הועתק'
      : status === 'error'
        ? 'לא הצלחנו להעתיק'
        : 'העתק קישור'

  const color =
    status === 'success'
      ? 'text-emerald-300'
      : status === 'error'
        ? 'text-red-300'
        : 'text-white/40 hover:text-white/70'

  return (
    <button
      onClick={handleCopy}
      disabled={status === 'loading'}
      className={`text-[12px] tracking-wide transition ${color}`}
    >
      {status === 'loading' ? '...' : label}
    </button>
  )
}
