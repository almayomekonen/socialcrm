'use client'
import { isAgentOrMngr } from '@/types/roles'
import { formatCurrency } from '@/lib/funcs'

export default function GoalsAndTotals({ user, data }) {
  if (!user || !isAgentOrMngr(user.role)) return null

  const { goals, monthly_totals, yearly_totals } = data
  let thereAreGoals = false
  for (const key in goals) {
    if (goals[key] && goals[key] !== '0' && goals[key] !== 0) {
      thereAreGoals = true
      break
    }
  }

  const categories = Object.keys(monthly_totals)

  // Check if there are any rows to display (rows with monthlyTotal > 0 OR valid goal)
  const hasRowsToDisplay = categories.some((key) => {
    const monthlyTotal = monthly_totals[key]
    const goal = goals?.[key]
    const hasValidGoal = goal && goal !== '0' && goal !== 0 && goal !== null
    return monthlyTotal > 0 || hasValidGoal
  })

  if (!hasRowsToDisplay) return null

  return (
    <div className='bg-white px-6 py-4 rounded-lg border'>
      <div className='text-md w-auto font-semibold'>
        {/* Header row */}
        <div className='mb-2.5 pb-1 border-b flex'>
          <div className='w-24 font-bold text-sm'>קטגוריות</div>
          <div className='flex flex-row gap-4'>
            <div className='w-28 text-left font-bold text-sm'>עסקאות החודש</div>
            {thereAreGoals && (
              <>
                <div className='w-24 text-left font-bold text-sm'>יעד חודשי</div>
                <div className='w-20 text-left font-bold text-sm'>הגעה ליעד</div>
                <div className='w-20 text-left font-bold text-sm'>קצב שנתי</div>
              </>
            )}
          </div>
        </div>

        {/* Data rows */}
        {categories.map((key) => {
          const monthlyTotal = monthly_totals[key]
          const goal = goals?.[key]
          const hasValidGoal = goal && goal !== '0' && goal !== 0 && goal !== null

          // Hide row if monthly total is 0 AND there's no valid goal
          if (monthlyTotal === 0 && !hasValidGoal) return null

          const yearlyTotal = yearly_totals[key]

          const precent = hasValidGoal ? Math.round((monthlyTotal / (Number(goal) / 12)) * 100) + '%' : null
          const rythem = hasValidGoal ? getRythem(Number(goal), yearlyTotal) : null
          const monthlyGoal = hasValidGoal ? formatCurrency(Math.round(Number(goal) / 12)) : null

          return (
            <div key={key} className='mb-2 flex flex-nowrap'>
              <div className='w-24 font-bold'>{key}</div>
              <div className='flex flex-row flex-nowrap gap-4'>
                <div className='w-28 text-left text-sm'>{formatCurrency(monthlyTotal)}</div>
                {hasValidGoal && (
                  <>
                    <div className='w-24 text-left text-sm'>{monthlyGoal}</div>
                    <div className='w-20 text-left text-sm'>{precent}</div>
                    <div className='w-20 text-left text-sm'>{rythem}</div>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function getRythem(goal, year_total) {
  const firstDay = new Date(new Date().getFullYear(), 0, 1) as any
  const daysPassed = Math.round((Date.now() - firstDay) / (1000 * 60 * 60 * 24))

  if (!daysPassed || !goal) return '0%'

  const avg = year_total / daysPassed
  const req = goal / 365
  return Math.round(100 * (avg / req)) + '%'
}
