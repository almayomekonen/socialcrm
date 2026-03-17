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
  const {
    clientsWithSales,
    prdctsCount,
    avgSalesPerClient,
    inHafakaCount,
    hofakCount,
    hafkadaCount,
    replaceCount,
    canceledCount,
    inProcessCount,
    totalRevenue,
  } = details

  return (
    <div className='flex gap-4 mobile:grid grid-cols-2'>
      <NumboxPrecent title='לקוחות פעילים' num={clientsWithSales} />
      <NumboxPrecent title='עסקאות' num={prdctsCount} />
      <NumboxPrecent title='עסקאות ממוצע ללקוח' num={avgSalesPerClient} />
      <NumboxPrecent title='הצעות שנשלחו' num={inHafakaCount} total={prdctsCount} />
      <NumboxPrecent title='עסקאות שנסגרו' num={hofakCount} total={prdctsCount} />
      <NumboxPrecent title='עסקאות ששולמו' num={hafkadaCount} total={prdctsCount} />
      <NumboxPrecent title='עסקאות עודכנו' num={replaceCount} total={prdctsCount} />
      <NumboxPrecent title='עסקאות שבוטלו/נגנזו' num={canceledCount} total={prdctsCount} />
      <NumboxPrecent title='עסקאות בתהליך' num={inProcessCount} total={prdctsCount} />
      <NumboxPrecent title='סך הכנסות' num={formatCurrency(totalRevenue)} />
    </div>
  )
}

function NumboxPrecent({ title, num, className = '', total = null }) {
  if (num === 'NaN' || (typeof num === 'number' && !isFinite(num))) num = 0
  else num = Number(num) || num || 0

  return (
    <div className={`num-box ${className}`}>
      <span>{title}</span>
      <div className='flex justify-between *:text-2xl'>
        <h2>{num}</h2>
        {total && <h2>{Number(((num / total) * 100).toFixed(1)) || 0}%</h2>}
      </div>
    </div>
  )
}
