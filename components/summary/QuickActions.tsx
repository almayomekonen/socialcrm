'use client'
import { Btn } from '@/lib/btns/Btn'

export default function QuickActions() {
  const actions = [
    {
      lbl: 'שינוי ליד ללקוח',
      icon: 'refresh',
    },
    {
      lbl: 'שליחת מייל',
      icon: 'mail',
    },
    {
      lbl: 'שליחת Whatsapp',
      icon: 'whatsapp',
    },
    {
      lbl: 'קביעת פגישה',
      icon: 'calendar',
    },
    {
      lbl: 'שליחת טופס אישור',
      icon: 'calendar',
    },
    {
      lbl: 'משיכת מידע ממקור א',
      icon: 'info',
    },

    {
      lbl: 'משיכת מידע ממקור ב',
      icon: 'alert',
    },
    {
      lbl: 'שינוי ליד לקוח',
      icon: 'alert',
    },
    {
      lbl: 'מסמך סיכום פגישה',
      icon: 'file',
    },
    {
      lbl: 'שליחת קוביות',
      icon: 'alert',
    },
  ]

  return (
    <div className='xl:p-8'>
      <h1 className='text-2xl font-bold my-4'>פעולות מהירות</h1>
      <div className='grid grid-cols-2 gap-2'>
        {actions.map((action) => (
          <Btn key={action.lbl} lbl={action.lbl} />
        ))}
      </div>
    </div>
  )
}
