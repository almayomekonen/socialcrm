import CmsnTable from '@/components/cmsnRules/CmsnTable'
import { getCmsnRules } from '@/db/cmsnRules'

export default async function CalcCmsnPage({ searchParams }) {
  const cmsnRules = await getCmsnRules()

  let { rule } = await searchParams
  if (rule) rule = JSON.parse(rule)

  return (
    <div>
      <CmsnTable cmsnRules={cmsnRules} />
    </div>
  )
}
