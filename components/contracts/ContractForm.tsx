'use client'

import { useEffect, useState } from 'react'
import { Input, Select } from '@/lib/form'
import { getFormData2 } from '@/lib/form/funcs'
import { upsertCont, duplicateCont } from '../../actions/contracts'
import { Btn } from '@/lib/btns/Btn'
import { redirect } from 'next/navigation'
import { api } from '@/lib/funcs'
import { Roles } from '@/types/roles'
import { fetchUserNameById, fetchUsersByMngrId } from '../../actions/usersNteams'
import { MultiSelectSearch } from '@/lib/form/MultiSelectSearch'
import { SelectSearch } from '@/lib/form/SelectSearch'

interface ContractFormProps {
  contracts: any[]
  users: any[]
  contract?: any
  isDuplicate?: boolean
}

export default function ContractForm({ contracts, users, contract = null, isDuplicate = false }: ContractFormProps) {
  if (isDuplicate) contract = { id: contract?.id, name: contract?.name }

  useEffect(() => {
    if (contract?.mngrId) onMngrChange({ id: contract?.mngrId })
  }, [])

  const [contractType, setContractType] = useState<'ראשי' | 'נציג' | 'מנהל' | string>(contract?.type || 'ראשי')
  const [mngrUsers, setMngrUsers] = useState([])

  async function onSubmitContract(e) {
    const data = getFormData2(e) as any

    if (contract?.id) data.id = contract?.id

    const valid = await checkIfUsersOrMngrExists(data, contracts)
    if (valid) return alert(`${valid.type} ${valid.userName} קיים בחוזה ${valid.contractName}`)

    const contractId = isDuplicate ? await api(duplicateCont, data) : await api(upsertCont, data)

    if (contractId) redirect(`/settings/edit_contracts/${contractId}`)
  }

  async function onMngrChange(mngr) {
    const usersOfMngr = await fetchUsersByMngrId(mngr?.id)
    console.log('usersOfMngr', usersOfMngr)
    setMngrUsers(usersOfMngr)
  }

  return (
    <form onSubmit={onSubmitContract} className='max-w-md'>
      <div className='flex justify-between mb-8 items-start'>
        <h1 className='title'>{isDuplicate ? 'שכפול חוזה ' + contract?.name : 'יצירת חוזה ' + contractType}</h1>
        <Btn lbl={isDuplicate ? 'שכפול' : 'שמירה'} icon={isDuplicate ? 'copy' : 'floppy-disk'} />
      </div>
      <div className='flex mb-6 gap-6'>
        <Input lbl='שם החוזה' name='name' type='text' className='' defaultValue={isDuplicate ? '' : contract?.name} />

        <Select
          options={['ראשי', 'נציג', 'מנהל']}
          placeholder='בחר סוג החוזה'
          lbl='סוג החוזה'
          name='type'
          defaultValue={contract?.type}
          className='w-[200px]'
          onChange={(e) => setContractType(e.target.value as any)}
        />
      </div>

      {contractType === 'מנהל' && (
        <div className='grid gap-4'>
          <SelectSearch
            options={users.filter((a) => a.role === Roles.MNGR)}
            name='mngrId'
            selected={contract?.mngrId}
            onSelectOpt={onMngrChange}
            lbl='מנהל'
          />
        </div>
      )}

      <MultiSelectSearch
        key={contractType === 'מנהל' ? JSON.stringify(mngrUsers) : 'all'}
        className='mt-4'
        options={contractType === 'מנהל' ? mngrUsers : users}
        name='userIds'
        selected={contract?.userIds}
        lbl='נציגים'
      />
    </form>
  )
}

async function checkIfUsersOrMngrExists(data, contracts) {
  for (const c of contracts) {
    if (data.mngrId && c.mngrId == data.mngrId && c.id != data.id) {
      const mngrName = await fetchUserNameById(data.mngrId)
      const contractName = c.name
      return { valid: true, userName: mngrName, contractName, type: 'מנהל' }
    }

    if (!c.userIds?.length) continue
    for (const id of c?.userIds) {
      if (c.type === data.type && data.userIds.includes(String(id)) && c.id != data.id) {
        const userName = await fetchUserNameById(id)
        const contractName = c.name
        return { valid: true, userName, contractName, type: 'נציג' }
      }
    }
  }
  return null
}
