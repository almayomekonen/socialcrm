'use client'

import { useState } from 'react'
import { updateDefaultSettings } from '@/actions/usersNteams'
import { api } from '@/lib/funcs'
import { getFormData2 } from '@/lib/form/funcs'
import { CheckboxBool } from '@/lib/checkbox/CheckboxBool'
import { InputSides } from '@/lib/form'
import { Btn } from '@/lib/btns/Btn'
import { Seperator } from '@/lib/Seperator'
import AccordionItem from '@/lib/AccordionItem'

export default function AiSettingsForm({ data, userId }) {
  const [coldEnabled, setColdEnabled] = useState(!!data.isRiskUpdated)
  const [stuckEnabled, setStuckEnabled] = useState(!!data.isMahalotKashotUpdated)

  async function onSubmit(e) {
    const formData = getFormData2(e)
    console.log(formData)
    api(updateDefaultSettings, [formData, userId])
  }

  return (
    <form onSubmit={onSubmit}>
      <div className='accordion border rounded-lg mb-6 max-w-3xl bg-white'>
        <AccordionItem title='זיהוי לידים' bodyClass='p-6' open>
          <div className='grid gap-6'>
            {/* Cold lead */}
            <div className='grid gap-3'>
              <CheckboxBool
                lbl='הפעל זיהוי לידים קרים'
                name='isRiskUpdated'
                defaultChecked={data.isRiskUpdated}
                onChange={(e: any) => setColdEnabled(e.target.checked)}
              />
              <p className='text-sm text-gray-500 ms-1'>ליד שלא עודכן מספיק זמן יסומן כקר ברשימת הלידים</p>
              <InputSides
                lblRight='ליד ללא פעילות מעל'
                lblLeft='חודשים'
                name='monthsLidimSheloHufku'
                type='number'
                min='1'
                defaultValue={data.monthsLidimSheloHufku ?? 3}
                disabled={!coldEnabled}
                inputCls={!coldEnabled ? 'opacity-40 cursor-not-allowed' : ''}
              />
            </div>

            <Seperator />

            {/* Stuck lead */}
            <div className='grid gap-3'>
              <CheckboxBool
                lbl='הפעל זיהוי לידים תקועים'
                name='isMahalotKashotUpdated'
                defaultChecked={data.isMahalotKashotUpdated}
                onChange={(e: any) => setStuckEnabled(e.target.checked)}
              />
              <p className='text-sm text-gray-500 ms-1'>ליד שנשאר באותו מצב זמן רב יסומן לבדיקה</p>
              <InputSides
                lblRight='ליד ללא שינוי מעל'
                lblLeft='חודשים'
                name='monthsUpdated'
                type='number'
                min='1'
                defaultValue={data.monthsUpdated ?? 2}
                disabled={!stuckEnabled}
                inputCls={!stuckEnabled ? 'opacity-40 cursor-not-allowed' : ''}
              />
            </div>
          </div>
        </AccordionItem>

        <AccordionItem title='ניהול שיוך' bodyClass='p-6'>
          <div className='grid gap-3'>
            <CheckboxBool
              lbl='הדגש לידים ללא נציג'
              name='isBituachHaimMutzarHaser'
              defaultChecked={data.isBituachHaimMutzarHaser}
            />
            <p className='text-sm text-gray-500 ms-1'>לידים שלא שויכו לנציג יסומנו ברשימה</p>
          </div>
        </AccordionItem>
      </div>

      <div className='max-w-3xl'>
        <Btn lbl='שמור הגדרות' className='w-full' />
      </div>
    </form>
  )
}
