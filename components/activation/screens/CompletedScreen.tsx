'use client'

import { useState } from 'react'
import type { ScreenCopy } from '@/lib/activation/activationCopy'
import { Btn } from '@/lib/btns/Btn'

export default function CompletedScreen({
  copy,
  onContinue,
}: {
  copy: ScreenCopy
  onContinue: () => Promise<boolean>
}) {
  const [copied, setCopied] = useState(false)

  async function handle() {
    const ok = await onContinue()
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    }
  }

  return (
    <div className='flex flex-col items-center gap-6 text-center'>
      <h1 className='text-[26px] font-bold text-white desktop:text-[#0f1024]'>{copy.heading}</h1>
      {copy.body && <p className='max-w-[320px] text-[14px] text-white/70 desktop:text-gray-600'>{copy.body}</p>}
      {copy.instruction && (
        <p className='max-w-[320px] text-[14px] text-white/85 desktop:text-gray-700'>{copy.instruction}</p>
      )}
      <Btn
        lbl={copied ? 'הקישור הועתק' : copy.ctaLabel ?? ''}
        onClick={handle}
        className='w-full max-w-[320px] justify-center'
      />
      {copy.secondary && (
        <p className='text-[12px] text-white/45 desktop:text-gray-400' dir='rtl'>
          {copy.secondary}
        </p>
      )}
    </div>
  )
}
