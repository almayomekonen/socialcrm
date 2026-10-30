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
import { useT } from '@/lib/i18n/I18nProvider'

export default function AiSettingsForm({ data, userId }) {
  const t = useT()
  const [coldEnabled, setColdEnabled] = useState(!!data.isRiskUpdated)
  const [stuckEnabled, setStuckEnabled] = useState(!!data.isMahalotKashotUpdated)

  async function onSubmit(e) {
    const formData = getFormData2(e)
    api(updateDefaultSettings, [formData, userId])
  }

  return (
    <form onSubmit={onSubmit}>
      <div className='accordion border rounded-lg mb-6 max-w-3xl bg-white'>
        <AccordionItem title={t('settings.account.system.detection')} bodyClass='p-6' open>
          <div className='grid gap-6'>
            {/* Cold lead */}
            <div className='grid gap-3'>
              <CheckboxBool
                lbl={t('settings.account.system.cold')}
                name='isRiskUpdated'
                defaultChecked={data.isRiskUpdated}
                onChange={(e: any) => setColdEnabled(e.target.checked)}
              />
              <p className='text-sm text-gray-500 ms-1'>{t('settings.account.system.coldHint')}</p>
              <InputSides
                lblRight={t('settings.account.system.coldOver')}
                lblLeft={t('settings.account.system.months')}
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
                lbl={t('settings.account.system.stuck')}
                name='isMahalotKashotUpdated'
                defaultChecked={data.isMahalotKashotUpdated}
                onChange={(e: any) => setStuckEnabled(e.target.checked)}
              />
              <p className='text-sm text-gray-500 ms-1'>{t('settings.account.system.stuckHint')}</p>
              <InputSides
                lblRight={t('settings.account.system.stuckOver')}
                lblLeft={t('settings.account.system.months')}
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

        <AccordionItem title={t('settings.account.system.assignment')} bodyClass='p-6'>
          <div className='grid gap-3'>
            <CheckboxBool
              lbl={t('settings.account.system.unassigned')}
              name='isBituachHaimMutzarHaser'
              defaultChecked={data.isBituachHaimMutzarHaser}
            />
            <p className='text-sm text-gray-500 ms-1'>{t('settings.account.system.unassignedHint')}</p>
          </div>
        </AccordionItem>
      </div>

      <div className='max-w-3xl'>
        <Btn lbl={t('settings.account.system.save')} className='w-full' />
      </div>
    </form>
  )
}
