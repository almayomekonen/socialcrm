import { redirect } from 'next/navigation'
import CmsnTable from '@/components/cmsnRules/CmsnTable'
import { getCmsnRules } from '@/db/cmsnRules'

export default async function CalcCmsnPage({ searchParams }) {
  redirect('/settings')
  const cmsnRules = await getCmsnRules()

  let { rule } = await searchParams
  if (rule) rule = JSON.parse(rule)

  if (cmsnRules.length === 0) {
    return <div className='flex items-center justify-center h-64 text-gray-400'>אין כללי עמלה עדיין</div>
  }

  return (
    <div>
      <CmsnTable cmsnRules={cmsnRules} />
    </div>
  )
}
