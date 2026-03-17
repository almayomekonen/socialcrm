import { formatRoundCurrency } from '@/lib/funcs'

export function SumBox({ lbl1, lbl2, val1, val2, sumLbl }) {
  const sum = val1 + val2
  return (
    <div className='bg-white border p-4 rounded-lg'>
      <h3 className='font-semibold'>{sumLbl}</h3>
      <p className='text-2xl mb-4'>{formatRoundCurrency(sum)}</p>
      <div className='flex justify-left gap-6'>
        <div className='grid'>
          <p className='font-semibold'>{lbl1}</p>
          <p>{formatRoundCurrency(val1)}</p>
        </div>
        <div className='grid'>
          <p className='font-semibold'>{lbl2}</p>
          <p>{formatRoundCurrency(val2)}</p>
        </div>
      </div>
    </div>
  )
}
