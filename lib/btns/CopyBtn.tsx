'use client'
import { copyToClipboard } from '@/lib/funcs'
import { useState } from 'react'
import Icon from '@/lib/Icon'

export function CopyBtn({ val, lbl = 'העתק' }) {
  const [copied, setCopied] = useState(false)

  function clicked() {
    copyToClipboard(val)
    setCopied(true)
    setTimeout(() => {
      setCopied(false)
    }, 2000)
  }
  return (
    <>
      <button
        data-tip={copied ? 'הועתק ללוח' : lbl}
        onClick={() => clicked()}
        className='bg-softy cursor-pointer rounded-xl p-2 flex items-center gap-2'
      >
        <Icon name={copied ? 'check' : 'copy'} className='size-4 bg-solid' />
      </button>
    </>
  )
}
