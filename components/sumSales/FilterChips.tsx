'use client'
import { formatDate } from '@/lib/dates'
import { ToolTip } from '../../lib/Tooltip'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'

export function FilterChips({ filter }) {
  const router = useRouter()

  const chips = [
    {
      label: 'ת.פנייה',
      getValues: (f) => {
        if (!f?.dateRange) return []
        if (f.dateRange === 'מותאם אישית') return [`${formatDate(f.start)} - ${formatDate(f.end)}`]
        return [f.dateRange]
      },
      keysToRemove: ['dateRange', 'start', 'end'],
    },
    {
      label: 'ת.סגירה',
      getValues: (f) => {
        if (!f?.saleDtRange) return []
        if (f.saleDtRange === 'מותאם אישית') return [`${formatDate(f.saleDtStart)} - ${formatDate(f.saleDtEnd)}`]
        return [f.saleDtRange]
      },
      keysToRemove: ['saleDtRange', 'saleDtStart', 'saleDtEnd'],
    },
    { label: 'פעולה', getValues: (f) => (f?.action ? [f.action] : []), keysToRemove: ['action'] },
    { label: 'ענף', getValues: (f) => (f?.branch ? [f.branch] : []), keysToRemove: ['branch', 'prdct', 'prdctType'] },
    { label: 'מוצרים', getValues: (f) => f?.prdct || [], keysToRemove: ['prdct'] },
    { label: 'סוגי מוצר', getValues: (f) => f?.prdctType || [], keysToRemove: ['prdctType'] },
    { label: 'חברות', getValues: (f) => f?.company || [], keysToRemove: ['company'] },
    { label: 'סטטוס', getValues: (f) => f?.status || [], keysToRemove: ['status'] },
    {
      label: 'לקוחות',
      getValues: (f) => f?.clientNames || [],
      keysToRemove: ['clientNames', 'clientIds'],
    },
    { label: 'נציגים', getValues: (f) => f?.userNames || [], keysToRemove: ['userNames', 'userIds'] },
    { label: 'צוותים', getValues: (f) => f?.teamNames || [], keysToRemove: ['teamNames', 'teamIds'] },
    { label: 'אחראים', getValues: (f) => f?.handlerNames || [], keysToRemove: ['handlerNames', 'handlerIds'] },
    { label: 'החלפה בלבד', getValues: (f) => (f?.replace ? ['פעיל'] : []), keysToRemove: ['replace'] },
    { label: 'שת"פ בלבד', getValues: (f) => (f?.isCollab ? ['פעיל'] : []), keysToRemove: ['isCollab'] },
  ]

  const activeFilters = chips
    .map((chip) => ({
      ...chip,
      values: chip.getValues(filter),
    }))
    .filter((chip) => chip.values.length > 0)

  if (activeFilters.length === 0) {
    return null
  }

  function handleRemoveFilter(lbl: string) {
    const chip = chips.find((c) => c.label === lbl)
    if (!chip) return

    const tmp = { ...filter }
    chip.keysToRemove.forEach((key) => delete tmp[key])
    router.replace(`?filter=${JSON.stringify(tmp)}`)
  }

  const oneValLbl = ['ענף', 'פעולה']

  return (
    <div className='flex gap-0'>
      {activeFilters.length > 0 && <p className='text-sm font-semibold'>סינונים פעילים: </p>}

      <div className='flex gap-1 flex-wrap px-2'>
        {activeFilters.map(({ label, values }) => (
          <div className=' relative flex  gap-1 bg-gray-200/70 text-sm pl-2 pr-3 py-1 rounded-full' key={label}>
            {oneValLbl.includes(label) ? (
              <span>{values[0]}</span>
            ) : (
              <ToolTip
                pos='bottom'
                lbl={
                  <>
                    {values.slice(0, 8).map((value) => (
                      <p key={value}>{value}</p>
                    ))}
                    {values.length > 8 && <p className='text-gray-400'>+{values.length - 8} נוספים</p>}
                  </>
                }
              >
                {label} {values.length > 1 ? `(${values.length})` : ''}
              </ToolTip>
            )}
            <Btn
              variant='sign'
              size='icon'
              className='bg-gray-100 absolute -left-1 border  border-gray-300 -top-1 rounded-full size-3.5 shadow-1 flex justify-center'
              icon='xmark'
              iconClassName='size-2.5'
              onClick={() => handleRemoveFilter(label)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
