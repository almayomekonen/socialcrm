'use client'

import { useEffect, useState } from 'react'
import Icon from './Icon'

type PopIcon = 'success' | 'error' | 'loading' | 'ban' | 'hide'

let popEl: HTMLElement | null = null
export let toast: (icon: PopIcon, msg?: string) => void = () => {}

const defaultMsg: { [key in PopIcon]: string } = {
  success: 'בוצע בהצלחה!',
  error: 'אירעה שגיאה!',
  loading: 'טוען...',
  ban: 'אינך מורשה',
  hide: '',
}

export default function ToastMsg() {
  const [pop, setPop] = useState<{ icon: PopIcon; msg: string }>({
    icon: 'loading',
    msg: defaultMsg['loading'],
  })

  useEffect(() => {
    popEl = document.getElementById('popMsg')
  }, [])

  toast = function (icon: PopIcon, msg?: string) {
    setPop({ icon, msg: msg || defaultMsg[icon] })
    popEl?.showPopover()
  }

  if (pop.icon === 'hide') return <div className='size-0 opacity-0' popover='auto' id='popMsg' />

  return (
    <div className='toast' popover='auto' id='popMsg'>
      <div className='flex ps-6 pe-9 py-3 font-medium text-white'>
        {icons[pop.icon]}
        <h3 className='font-medium'>{pop.msg}</h3>
      </div>
    </div>
  )
}

const icons = {
  success: <Icon name='check' type='reg' className='bg-white rtl:scale-x-100 size-5' />,
  error: <Icon name='triangle-exclamation' type='reg' className='bg-white size-5' />,
  ban: <Icon name='ban' type='reg' className='bg-white size-5' />,
  loading: <div className='size-5 border-2 rounded-full border-white animate-spin border-t-transparent' />,
}
