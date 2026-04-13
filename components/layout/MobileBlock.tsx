'use client'

import { useState } from 'react'
import { copyToClipboard } from '@/lib/clipboard'

export default function MobileBlock() {

  return (
    <div
      dir='rtl'
      className='fixed inset-0 z-9999 flex flex-col items-center justify-center overflow-hidden md:hidden'
      style={{ background: 'linear-gradient(160deg, #080613 0%, #0f0c24 45%, #080d1a 100%)' }}
    >
      {/* Glow orbs */}
      <div className='absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 size-[500px] rounded-full animate-pulse blur-[80px]' style={{ background: 'radial-gradient(circle, rgba(63,32,245,0.35) 0%, transparent 65%)' }} />
      <div className='absolute bottom-0 right-0 size-72 rounded-full animate-pulse blur-[60px]' style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.2) 0%, transparent 70%)', animationDelay: '1.2s' }} />
      <div className='absolute bottom-1/3 left-0 size-48 rounded-full animate-pulse blur-[50px]' style={{ background: 'radial-gradient(circle, rgba(167,139,250,0.15) 0%, transparent 70%)', animationDelay: '0.6s' }} />

      {/* Main card */}
      <div
        className='relative mx-5 px-7 py-8 rounded-3xl text-center'
        style={{
          background: 'rgba(255,255,255,0.035)',
          backdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.07)',
          boxShadow: '0 0 0 1px rgba(63,32,245,0.1), 0 0 100px rgba(63,32,245,0.12), 0 30px 60px rgba(0,0,0,0.6)',
          animation: 'fade-scale-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        }}
      >
        {/* Badge */}
        <div className='inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium mb-6' style={{ background: 'rgba(63,32,245,0.15)', border: '1px solid rgba(63,32,245,0.35)', color: '#c4b5fd' }}>
          <span className='size-1.5 rounded-full animate-pulse' style={{ background: '#818cf8' }} />
          גרסת מובייל בקרוב
        </div>

        {/* Headline */}
        <h1 className='text-[26px] bg-linear-to-br from-purple-200 font-bold text-transparent bg-clip-text leading-snug mb-3'>
          המערכת נבנתה
          <br />
          <span className='bg-linear-to-br from-purple-200 via-indigo-300 to-indigo-600 bg-clip-text text-transparent'>
            לעבודה אמיתית
          </span>
        </h1>

        {/* Subtext */}
        <p className='text-sm mb-7 text-white leading-relaxed'>
          כדי לנהל לידים, לעקוב אחרי שיחות
          <br />
          ולסגור עסקאות צריך מסך גדול
        </p>

        {/* CTA */}
        <div className='flex flex-col gap-3'>
          <div className='flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/10'>
            <MonitorIcon />
            <span className='text-sm text-white/70'>היכנס מהמחשב כדי להתחיל</span>
          </div>

          <CopyLinkButton />
        </div>
      </div>
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

  const label = status === 'success' ? 'הועתק!' : status === 'error' ? 'לא הצלחנו להעתיק' : 'העתק קישור לפתיחה במחשב'
  const color = status === 'success' ? 'text-green-400' : status === 'error' ? 'text-red-400' : 'text-white/70 hover:text-white/70'

  return (
    <button onClick={handleCopy} disabled={status === 'loading'} className={`text-xs transition ${color}`}>
      {status === 'loading' ? '...' : label}
    </button>
  )
}

function MonitorIcon() {
  return (
    <div className='size-9 rounded-xl grid place-items-center bg-indigo-500/20 border border-indigo-500/30'>
      <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='#a78bfa' strokeWidth='2'>
        <rect x='2' y='3' width='20' height='14' rx='2' />
        <line x1='8' y1='21' x2='16' y2='21' />
        <line x1='12' y1='17' x2='12' y2='21' />
      </svg>
    </div>
  )
}