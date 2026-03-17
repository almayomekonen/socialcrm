'use client'

import { addCmsnRule } from '@/db/cmsnRules'
import { Btn } from '@/lib/btns/Btn'
import { getFormData2 } from '@/lib/form/funcs'
import { api } from '@/lib/funcs'
import SelectPrdctOpts from './SelectPrdctOpts'
import { Input } from '@/lib/form'

export default function CmsnForm({ rule, setRule }) {
  async function onSubmit(e) {
    const data = getFormData2(e) as any
    if (rule?.id) data.id = rule?.id

    api(addCmsnRule, data)

    setRule({})
    e.target.reset()
  }

  return (
    <div>
      <h1 className='title my-8'>עריכת חישוב משוקלל</h1>
      <form className='flex items-end gap-4' onSubmit={onSubmit}>
        <SelectPrdctOpts prdct={rule} />
        <Input lbl='אחוז' type='number' name='cmsnRate' defaultValue={rule?.cmsnRate} className='w-30' step='any' />
        <Btn lbl={rule?.id ? 'עדכון' : 'שמירה'} icon={rule?.id ? 'floppy-disk-pen' : 'floppy-disk'} />
        {rule?.id && <Btn lbl='ביטול' icon='xmark' variant='outline' type='button' onClick={() => setRule({})} />}
      </form>
    </div>
  )
}
