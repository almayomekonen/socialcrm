import { formatDate, toInputDate } from '@/lib/dates'
import { formatCurrency, formatShortCurrency } from '@/lib/funcs'
import { FileDisplay } from '../files/funcs'
import Link from 'next/link'
import { isAgent } from '@/types/roles'
import { getUser } from '@/db/auth'
import { getTeamNUserNames } from '@/db/usersNTeams'

export default async function UserPromo({ curUser, promo }) {
  const user = await getUser()
  const goals = Object.keys(promo.goals.target)
  const target = promo.goals.target

  const conditions = []

  const teamIds = promo.grpIds
  const userIds = promo.isPromoGrp ? [] : isAgent(user.role) ? [user.id] : promo.combined_ids

  const { teamNames, userNames } = await getTeamNUserNames(teamIds, userIds)

  for (const condition of promo.goals.conditions) {
    conditions.push({
      dateRange: 'מותאם אישית',
      start: toInputDate(promo.start),
      end: toInputDate(promo.end),
      action: 'מכירה',
      teamIds: teamIds,
      teamNames: teamNames,
      userIds: userIds,
      userNames: userNames,
      branch: condition.branch == 'משוקלל' ? null : condition.branch,
      prdct: condition.prdcts,
      prdctType: condition.prdctTypes,
      company: condition.companies,
    })
  }

  return (
    <div className='grid gap-8 grid-cols-2 mt-8 mobile:grid-cols-1 pb-4'>
      <div className='paper grid grid-cols-2 gap-8'>
        <div>
          <h1 className='text-2xl mb-2 font-semibold'>{promo.title}</h1>
          <p className='whitespace-pre-wrap'>{promo.desc}</p>

          <p className='text-sm text-gray-600 mt-4'>
            תקופת המבצע: {formatDate(promo.start)} - {formatDate(promo.end)}
          </p>

          {promo.isPromoGrp && <p className='text-sm text-gray-600'>קמפיין למנהל</p>}

          {promo?.files?.length > 0 && (
            <div>
              <p className='text-sm text-gray-600 mt-2'>תקנון:</p>
              <FileDisplay tooltipClass='h-35' files={promo.files} className='mt-1' />
            </div>
          )}
          <div className='flex mt-4 gap-2'>
            {conditions.map((filter, i) => (
              <Link className='btn h-7 text-sm' key={i} href={`/?filter=${JSON.stringify(filter)}`}>
                {filter.branch || 'עמלה כוללת'}
                <p className='text-xs '>עסקאות</p>
              </Link>
            ))}
          </div>
        </div>
        {promo.img && <img className='min-h-42 rounded-md' src={promo.img.url} alt='' />}
      </div>

      {curUser &&
        (Array.isArray(curUser) ? curUser : [curUser]).map((user, t) => (
          <div className='paper pb-10 pl-8' key={t}>
            <p className='text-xl font-semibold mb-4 leading-none'>{user?.נציג || user?.צוות}</p>

            <div className='grid gap-8'>
              {goals.map((goal, i) => {
                const precent = Math.round(((user[goal] || 0) / (maxNum(target[goal]) || 1)) * 100)
                return (
                  <div key={i}>
                    <div>
                      <div className='flex justify-between prog items-end'>
                        <span className='mb-1'>
                          <p className='font-semibold'>{goal}</p>
                          <p className='text-sm text-gray-600'>{formatDate(promo.start)}</p>
                        </span>
                        <span className='mb-1 text-left'>
                          <p className='font-semibold'>{formatCurrency(user[goal])}</p>
                          <p className='text-sm text-gray-600 text-left'>{formatDate(promo.end)}</p>
                        </span>
                      </div>

                      <div className='relative'>
                        <div className='flex w-full h-4 bg-gray-200 rounded-full overflow-hidden'>
                          <div
                            className='text-left leading-4 text-sm text-white rounded-full h-full bg-gradient-to-l stripes shadow-xl bg-blue-950'
                            style={{ width: `${precent}%` }}
                          >
                            <p className='me-2'>{`${precent || 0}%`}</p>
                          </div>
                        </div>

                        <div className='absolute w-full top-2'>
                          {target[goal].length > 0 && (
                            <div>
                              {(() => {
                                const maxTarget = maxNum(target[goal])
                                const sortedTargets = sortAsc(target[goal])
                                return sortedTargets.map((p, j) => {
                                  const midTarget = (p / maxTarget) * 100
                                  const isLast = j === sortedTargets.length - 1
                                  return (
                                    <div
                                      className={`absolute w-[2px] h-4 top-0 ${isLast ? 'bg-green-500' : 'bg-yellow-500'}`}
                                      style={{ right: `calc(${midTarget}% )` }}
                                      key={`prize-${j}`}
                                    >
                                      <div
                                        className={`absolute whitespace-nowrap top-6 left-1/2 transform -translate-x-1/2 text-xs font-medium ${
                                          isLast ? 'text-green-700' : 'text-yellow-700'
                                        }`}
                                      >
                                        {formatShortCurrency(p)}
                                      </div>
                                    </div>
                                  )
                                })
                              })()}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
    </div>
  )
}

function maxNum(arr) {
  return Math.max(...arr)
}
function sortAsc(arr: number[]): number[] {
  const sorted = [...arr].sort((a, b) => a - b)
  return sorted
}
