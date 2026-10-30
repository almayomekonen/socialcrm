'use client'

import { Btn } from '@/lib/btns/Btn'
import { useState } from 'react'
import { Input } from '@/lib/form'
import { updateSavedFilters } from '../../actions/filter'
import { toast } from '@/lib/toast'
import { useDrag } from '@/lib/hooksNEvents'
import { useT } from '@/lib/i18n/I18nProvider'

export default function EditFilters({ filters, user }) {
  const t = useT()
  const [state, setState] = useState(false)
  const render = () => setState(!state)

  async function onSubmit() {
    toast('loading')
    await updateSavedFilters({ data: filters, id: user.id })
    toast('success', t('settings.account.filters.saved'))
  }

  return (
    <div className='min-w-60'>
      {filters?.length ? (
        filters.map((el, i) => (
          <div key={i} className='flex gap-4 mb-4' {...useDrag(filters, i, render)}>
            <Input defaultValue={el.name} name='name' onChange={(e) => (el.name = e.target.value)} />

            <Btn
              variant='outline'
              size='icon'
              icon='trash'
              aria-label={t('settings.account.filters.delete')}
              onClick={() => {
                filters.splice(i, 1)
                render()
              }}
            />
          </div>
        ))
      ) : (
        <p className='text-center my-2'>{t('settings.account.filters.none')}</p>
      )}

      <Btn lbl={t('settings.account.filters.save')} icon='floppy-disk' className='w-full' onClick={onSubmit} />
    </div>
  )
}
