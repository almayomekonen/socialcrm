'use client'

import { Btn } from '@/lib/btns/Btn'
import { deleteCmsnRule } from '../../db/cmsnRules'
import CmsnForm from './CmsnForm'
import { useState } from 'react'
import { api } from '@/lib/funcs'
export default function CmsnTable({ cmsnRules }) {
  function removeRule(id) {
    confirm('בטוח למחוק את הכלל?') && api(deleteCmsnRule, id)
  }

  const [rule, setRule] = useState<any>({})

  function onEdit(rule) {
    setRule(rule)
    scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <>
      <CmsnForm rule={rule} setRule={setRule} key={rule?.id} />

      <div className='my-8 grid'>
        <table className='tbl'>
          <thead className='tblHead'>
            <tr className='*:text-start'>
              <th>ענף</th>
              <th>מוצר</th>
              <th>סוג מוצר</th>
              <th>חברה</th>
              <th>אחוז</th>
              <th>עריכה</th>
            </tr>
          </thead>
          <tbody className='tblBody'>
            {cmsnRules.map((cmsnRule) => (
              <tr key={cmsnRule.id}>
                <td>{cmsnRule.branch}</td>
                <td>{cmsnRule.prdcts?.join(', ') || 'הכל'}</td>
                <td>{cmsnRule.prdctTypes?.join(', ') || 'הכל'}</td>
                <td>{cmsnRule.companies?.join(', ') || 'הכל'}</td>
                <td>{cmsnRule.cmsnRate}%</td>
                <td className='flex gap-2 flex-nowrap'>
                  <Btn variant='outline' size='icon' icon='trash' type='button' onClick={() => removeRule(cmsnRule.id)} />
                  <Btn variant='outline' size='icon' icon='pen' type='button' onClick={() => onEdit(cmsnRule)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
