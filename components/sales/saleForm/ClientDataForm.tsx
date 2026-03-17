import { Sale } from '@/types/db/tables'
import { useRef, useState } from 'react'
import { getClientByIdNum, searchClients, upsertClient } from '@/actions/clients'
import { useUser } from '@/lib/hooksNEvents'
import { Btn } from '@/lib/btns/Btn'
import Title from '@/lib/Title'
import { Input } from '@/lib/form'
import { SelectSearch } from '@/lib/form/SelectSearch'
import { isIdNumValid } from '@/lib/funcs'

type Props = {
  curSale?: Sale & { clientData: string }
}

export default function ClientDataForm({ curSale }: Props) {
  console.log('curSale', curSale)
  const user = useUser()
  const [client, setClient] = useState(curSale ? { details: curSale?.clientData, id: curSale?.clientId } : null)
  return (
    <div>
      <div className='flex w-full justify-between items-end border-b pb-2 mb-4 mobile:gap-y-2'>
        <div className='flex'>
          <h2 className='text-lg'>פרטי לקוח</h2>
        </div>
      </div>
      <section className='flex items-end'>
        <SelectSearch
          inputCls='w-52'
          key={client?.id}
          lbl='לקוח'
          initShow={client?.details}
          selected={client?.id}
          show='details'
          val='id'
          placeholder='חיפוש לקוח קיים..'
          name='clientId'
          searchFunc={searchClients}
        />
        <Btn type='button' icon='plus' variant='outline' lbl='לקוח חדש' popoverTarget='clientSaleForm' />
      </section>
      <ClientSaleFormPop user={user} setClient={setClient} />
    </div>
  )
}

function ClientSaleFormPop({ user, setClient }) {
  const firstNameRef = useRef(null)
  const lastNameRef = useRef(null)
  const idNumRef = useRef(null)

  async function onSubmit() {
    const data = {
      firstName: firstNameRef.current?.value,
      lastName: lastNameRef.current?.value,
      idNum: idNumRef.current?.value,
      userId: user.id,
      handlerId: user.id,
    }

    if (!data.firstName || !data.lastName || !data.idNum) return alert('יש למלא את כל השדות')
    if (!isIdNumValid(data.idNum)) return alert('תעודת זהות לא תקינה')
    const existingClient = await getClientByIdNum(data.idNum)
    if (existingClient) return alert(`תעודת זהות זו משוייכת ללקוח ${existingClient.name}`)

    const res = await upsertClient(user.id, data, null, false)
    if (res.err) return alert(res.msg)

    setClient(res)
    // reset form
    document.getElementById('clientSaleForm')?.hidePopover()
    firstNameRef.current!.value = ''
    lastNameRef.current!.value = ''
    idNumRef.current!.value = ''
  }
  return (
    <div id='clientSaleForm' popover='auto' className='pop w-75'>
      <Title lbl='יצירת לקוח חדש' className='mb-4 w-full' />
      <div className='grid gap-2'>
        <Input name='firstName' ref={firstNameRef} lbl='שם פרטי' required={false} />
        <Input name='lastName' ref={lastNameRef} lbl='שם משפחה' required={false} />
        <Input type='number' name='idNum' ref={idNumRef} lbl='תעודת זהות' required={false} />
      </div>
      <Btn type='button' className='mt-4 w-full' lbl='שמירה' onClick={onSubmit} icon='floppy-disk' />
    </div>
  )
}
