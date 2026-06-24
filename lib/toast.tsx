'use client'

import { useEffect, useState } from 'react'
import Icon from './Icon'

type PopIcon = 'success' | 'error' | 'loading' | 'ban' | 'hide' | 'message'

let popEl: HTMLElement | null = null
let closeTimer: ReturnType<typeof setTimeout> | null = null
// Optional onClick makes a toast actionable (e.g. open a conversation). Backward
// compatible: existing 3-arg callers pass no handler and render exactly as before.
export let toast: (icon: PopIcon, msg?: string, durationMs?: number, onClick?: () => void) => void = () => {}

const defaultMsg: { [key in PopIcon]: string } = {
  success: 'בוצע בהצלחה!',
  error: 'אירעה שגיאה!',
  loading: 'טוען...',
  ban: 'אינך מורשה',
  hide: '',
  message: 'הודעה חדשה',
}

export default function ToastMsg() {
  const [pop, setPop] = useState<{ icon: PopIcon; msg: string; onClick?: () => void }>({
    icon: 'loading',
    msg: defaultMsg['loading'],
  })

  useEffect(() => {
    popEl = document.getElementById('popMsg')
  }, [])

  toast = function (icon: PopIcon, msg?: string, durationMs?: number, onClick?: () => void) {
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
    setPop({ icon, msg: msg || defaultMsg[icon], onClick })
    popEl?.showPopover()
    if (icon !== 'loading') closeTimer = setTimeout(() => { popEl?.hidePopover(); closeTimer = null }, durationMs ?? 3000)
  }

  if (pop.icon === 'hide') return <div className='size-0 opacity-0' popover='auto' id='popMsg' />

  const body = (
    <div className='flex items-center gap-4 ps-6 pe-9 py-3 font-medium text-white'>
      {icons[pop.icon]}
      <h3 className='font-medium whitespace-pre-line leading-snug'>{pop.msg}</h3>
    </div>
  )

  return (
    <div className='toast' popover='auto' id='popMsg'>
      {pop.onClick ? (
        <button
          type='button'
          className='w-full cursor-pointer text-start'
          onClick={() => {
            pop.onClick?.()
            popEl?.hidePopover()
          }}
        >
          {body}
        </button>
      ) : (
        body
      )}
    </div>
  )
}

const icons = {
  success: <Icon name='check' type='reg' className='bg-white rtl:scale-x-100 size-5' />,
  error: <Icon name='triangle-exclamation' type='reg' className='bg-white size-5' />,
  ban: <Icon name='ban' type='reg' className='bg-white size-5' />,
  loading: <div className='size-5 border-2 rounded-full border-white animate-spin border-t-transparent' />,
  message: <Icon name='comment-dots' type='reg' className='bg-white size-5' />,
}
