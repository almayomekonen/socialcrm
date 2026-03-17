'use client'
import { Input } from '@/lib/form'
import { getFormData2 } from '@/lib/form/funcs'
import { Btn } from '@/lib/btns/Btn'
import { api } from '@/lib/funcs'
import FileUploader from '@/components/files/FileUploader'
import { updateAgency } from '@/actions/agencies'

export default function EditAgency({ agency }) {
  async function onSubmit(e) {
    const data = getFormData2(e)
    console.log(data)
    data.img = JSON.parse(data.img)
    api(updateAgency, [data, agency.id])
  }

  return (
    <form onSubmit={onSubmit}>
      <div className='grid grid-cols-1 gap-4'>
        <Input name='name' lbl='שם העסק' defaultValue={agency.name} />
        <FileUploader name='img' single type='image' tooltipClass='h-20' initialFiles={agency.img} title='העלאת לוגו העסק' />
      </div>
      <Btn lbl='שמירה' className='w-full mt-4' />
    </form>
  )
}
