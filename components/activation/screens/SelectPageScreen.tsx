'use client'

import { useState } from 'react'
import type { ScreenCopy } from '@/lib/activation/activationCopy'
import type { FacebookPage } from '@/lib/activation/activationState'
import { Btn } from '@/lib/btns/Btn'
import ActivationProgress from '@/components/activation/ActivationProgress'

export default function SelectPageScreen({
  copy,
  progress,
  pages,
  onSelect,
}: {
  copy: ScreenCopy
  progress: number
  pages: FacebookPage[]
  onSelect: (id: string) => void
}) {
  const [id, setId] = useState('')
  return (
    <div className='flex flex-col items-center gap-6 text-center'>
      <ActivationProgress label={copy.progressLabel} progress={progress} />
      <h1 className='text-[24px] font-bold text-white'>{copy.heading}</h1>
      <select
        value={id}
        onChange={(e) => setId(e.target.value)}
        className='h-11 w-full max-w-[320px] rounded-md bg-white px-3 text-black'
      >
        <option value=''>—</option>
        {pages.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <Btn
        lbl={copy.ctaLabel ?? ''}
        disabled={!id}
        onClick={() => id && onSelect(id)}
        className='w-full max-w-[320px] justify-center'
      />
    </div>
  )
}
