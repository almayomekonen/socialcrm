'use client'

import { Btn } from '@/lib/btns/Btn'
import { Input, Select } from '@/lib/form'
import { useEffect, useState } from 'react'
import { prdctOptByBranch } from '@/types/lists'
import { upsertContPrdcts, deleteContPrdct } from '../../actions/contracts'
import { api } from '@/lib/funcs'
import SimpleTable from '@/lib/table/SimpleTable'
import { getFormData2 } from '@/lib/form/funcs'
import SelectPrdctOpts from '../cmsnRules/SelectPrdctOpts'

export default function ContractPrdctsForm({ contract, contractPrdcts }: any) {
  const [prdct, setPrdct] = useState<any>({})
  const [selectedPrdct, setSelectedPrdct] = useState<any>({})

  async function onSubmitProducts(e) {
    const data = getFormData2(e) as any
    data.contractId = contract.id
    if (selectedPrdct?.id) {
      data.id = selectedPrdct?.id
      setSelectedPrdct({})
    }

    api(upsertContPrdcts, data)
  }

  async function removeProduct(id: number) {
    confirm('בטוח למחוק את המוצר?') && api(deleteContPrdct, id)
  }

  useEffect(() => {
    if (selectedPrdct?.id) setPrdct(prdctOptByBranch[selectedPrdct?.branch])
  }, [selectedPrdct])

  function onTagmulTypeChange(e) {
    const el = document.querySelector('input[name="fromAmount"]') as HTMLInputElement
    el.value = '0'
    el.disabled = e.target.value === 'על תשלומים'
  }

  return (
    <>
      <h1 className='title my-6'>מוצרים לחוזה</h1>
      <form className='flex  items-end' onSubmit={onSubmitProducts} key={selectedPrdct?.id}>
        <div className='flex gap-2'>
          <SelectPrdctOpts prdct={selectedPrdct} />

          <Input lbl='אחוז עמלה' type='number' name='prcnt' defaultValue={selectedPrdct?.prcnt} step='any' className='!w-24' />

          <Select
            options={['על מחזור', 'על תשלומים']}
            lbl='סוג תגמול'
            name='tagmulType'
            defaultValue={selectedPrdct?.tagmulType}
            onChange={onTagmulTypeChange}
          />

          <Input
            lbl='מדרגה מסכום'
            required={false}
            type='number'
            name='fromAmount'
            defaultValue={selectedPrdct?.fromAmount}
            step='any'
            className='w-24'
          />
        </div>

        <div className='flex gap-4'>
          <Btn lbl={selectedPrdct?.id ? 'עדכון' : 'שמירה'} icon={selectedPrdct?.id ? 'floppy-disk-pen' : 'floppy-disk'} />
          {selectedPrdct?.id && (
            <Btn lbl='ביטול' icon='xmark' variant='outline' type='button' onClick={() => setSelectedPrdct({})} />
          )}
        </div>
      </form>

      <div className='my-4 grid'>
        <SimpleTable columns={tableColumns(setSelectedPrdct, removeProduct)} data={contractPrdcts} />
      </div>
    </>
  )
}

function tableColumns(onEdit, onDelete) {
  return [
    { label: 'ענף', key: 'branch' },
    { label: 'מוצר', render: (row) => row.prdcts?.join(', ') || 'הכל' },
    { label: 'סוג מוצר', render: (row) => row.prdctTypes?.join(', ') || 'הכל' },
    { label: 'חברה', render: (row) => row.companies?.join(', ') || 'הכל' },
    { label: 'אחוז עמלה', key: 'prcnt' },
    { label: 'סוג תגמול', key: 'tagmulType' },
    { label: 'מדרגה מסכום', key: 'fromAmount' },
    {
      label: 'עריכה',
      className: 'flex gap-2 flex-nowrap',
      render: (row) => (
        <>
          <Btn variant='outline' size='icon' icon='pen' type='button' onClick={() => onEdit(row)} />
          <Btn variant='outline' size='icon' icon='trash' type='button' onClick={() => onDelete(row.id)} />
        </>
      ),
    },
  ]
}
