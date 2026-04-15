'use client'

import { useState } from 'react'
import { copyToClipboard } from '@/lib/clipboard'

const PREVIEW_ROWS = [
  { name: 'דני לוי', status: 'סגור', color: 'green', source: 'פייסבוק' },
  { name: 'מיכל אברהם', status: 'בטיפול', color: 'blue', source: 'אינסטגרם' },
  { name: 'אבי שרון', status: 'ממתין', color: 'yellow', source: 'וואטסאפ' },
  { name: 'שרה פרץ', status: 'חדש', color: 'blue', source: 'פייסבוק' },
  { name: 'נועם ביטון', status: 'אבוד', color: 'gray', source: 'וואטסאפ' },
]

const DOT: Record<string, string> = {
  green: 'bg-emerald-400',
  blue: 'bg-blue-400',
  yellow: 'bg-yellow-400',
  gray: 'bg-gray-500',
}

const BADGE: Record<string, string> = {
  green: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  blue: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  yellow: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  gray: 'bg-white/10 text-white/40 border-white/10',
}

export default function MobileBlock() {
  return (
    <div
      dir='rtl'
      className='fixed inset-0 z-9999 flex flex-col items-center justify-center overflow-hidden desktop:hidden'
      style={{ background: 'linear-gradient(160deg, #080613 0%, #0f0c24 45%, #080d1a 100%)' }}
    >
      {/* Glow orbs */}
      <div className='absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 size-[500px] rounded-full animate-pulse blur-[80px]' style={{ background: 'radial-gradient(circle, rgba(63,32,245,0.35) 0%, transparent 65%)' }} />
      <div className='absolute bottom-0 right-0 size-72 rounded-full animate-pulse blur-[60px]' style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.2) 0%, transparent 70%)', animationDelay: '1.2s' }} />
      <div className='absolute bottom-1/3 left-0 size-48 rounded-full animate-pulse blur-[50px]' style={{ background: 'radial-gradient(circle, rgba(167,139,250,0.15) 0%, transparent 70%)', animationDelay: '0.6s' }} />

      {/* Main card */}
      <div
        className='relative mx-5 px-6 pt-6 pb-5 rounded-3xl'
        style={{
          background: 'rgba(255,255,255,0.035)',
          backdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.07)',
          boxShadow: '0 0 0 1px rgba(63,32,245,0.1), 0 0 100px rgba(63,32,245,0.12), 0 30px 60px rgba(0,0,0,0.6)',
          animation: 'fade-scale-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        }}
      >
        {/* Badge */}
        <div className='inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium mb-4' style={{ background: 'rgba(63,32,245,0.15)', border: '1px solid rgba(63,32,245,0.35)', color: '#c4b5fd' }}>
          <span className='size-1.5 rounded-full animate-pulse' style={{ background: '#818cf8' }} />
          גרסת מובייל בקרוב
        </div>

        {/* Headline */}
        <h1 className='text-[22px] font-bold text-white leading-snug mb-1'>
          המערכת נבנתה
          <br />
          <span className='bg-linear-to-br from-purple-200 via-indigo-300 to-indigo-500 bg-clip-text text-transparent'>
            לעבודה אמיתית
          </span>
        </h1>

        {/* Subtext */}
        <p className='text-xs text-white/40 mb-4 leading-relaxed'>
          היכנס מהמחשב כדי לנהל את הלידים שלך
        </p>

        {/* Mini CRM table preview */}
        <div
          className='rounded-xl overflow-hidden mb-4'
          style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.25)' }}
        >
          {/* Table header */}
          <div
            className='grid grid-cols-[1fr_72px_56px] gap-2 px-3 py-2 text-[10px] font-medium text-white/25'
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
          >
            <span className='text-center'>שם ליד</span>
            <span className='text-center'>סטטוס</span>
            <span className='text-center'>מקור</span>
          </div>

          {/* Rows */}
          {PREVIEW_ROWS.map((row, i) => (
            <div
              key={i}
              className='grid grid-cols-[1fr_72px_56px] gap-2 px-3 py-2 items-center'
              style={{ borderBottom: i < PREVIEW_ROWS.length - 1 ? '1px solid rgba(255,255,255,0.04)' : undefined }}
            >
              <div className='flex items-center gap-1.5 min-w-0'>
                <span className={`size-1.5 rounded-full flex-none ${DOT[row.color]}`} />
                <span className='text-white/70 text-xs truncate'>{row.name}</span>
              </div>
              <span className={`text-center px-2 py-0.5 rounded-full text-[10px] border ${BADGE[row.color]}`}>
                {row.status}
              </span>
              <span className='text-white/30 text-[10px] text-left'>{row.source}</span>
            </div>
          ))}
        </div>

        {/* CTAs */}
        <div className='flex flex-col gap-2'>
          <div className='flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/5 border border-white/10'>
            <MonitorIcon />
            <span className='text-xs text-white/60'>היכנס מהמחשב כדי להתחיל</span>
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
  const color = status === 'success' ? 'text-green-400' : status === 'error' ? 'text-red-400' : 'text-white/40 hover:text-white/60'

  return (
    <button onClick={handleCopy} disabled={status === 'loading'} className={`text-xs transition text-center ${color}`}>
      {status === 'loading' ? '...' : label}
    </button>
  )
}

function MonitorIcon() {
  return (
    <div className='size-8 rounded-lg grid place-items-center bg-indigo-500/20 border border-indigo-500/30 flex-none'>
      <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='#a78bfa' strokeWidth='2'>
        <rect x='2' y='3' width='20' height='14' rx='2' />
        <line x1='8' y1='21' x2='16' y2='21' />
        <line x1='12' y1='17' x2='12' y2='21' />
      </svg>
    </div>
  )
}
