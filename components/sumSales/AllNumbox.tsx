import { getSaleStats } from '@/db/sumSales'
import { formatCurrency } from '@/lib/funcs'

export default async function AllNumbox({ props }) {
  const { sqlFilter } = props
  const details = await getSaleStats(sqlFilter)

  return (
    <div className='my-8'>
      <ClientsBoxes details={details} />
    </div>
  )
}

function ClientsBoxes({ details }) {
  const { hofakCount, inProcessCount, totalRevenue, pipelineValue } = details || {}

  return (
    <div className='flex gap-4 mobile:grid grid-cols-2'>
      <NumboxPrecent title='סך הכנסות (שולם)' num={formatCurrency(totalRevenue)} className='bg-softy border-soft text-solid font-bold' />
      <NumboxPrecent title='עסקאות שנסגרו' num={hofakCount} />
      <NumboxPrecent title='פייפליין' num={formatCurrency(pipelineValue)} />
      <NumboxPrecent title='עסקאות בתהליך' num={inProcessCount} />
    </div>
  )
}

function NumboxPrecent({ title, num, className = '', total = null }) {
  if (num === 'NaN' || (typeof num === 'number' && !isFinite(num))) num = 0
  else num = Number(num) || num || 0

  return (
    <div className={`num-box min-w-60 py-6 px-6 ${className}`}>
      <span>{title}</span>
      <div className='flex justify-between *:text-3xl'>
        <h2>{num}</h2>
        {total && <h2>{Number(((num / total) * 100).toFixed(1)) || 0}%</h2>}
      </div>
    </div>
  )
}
