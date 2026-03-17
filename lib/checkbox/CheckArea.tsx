import { Checkbox } from '@/lib/form'

export default function CheckArea({ title, strArr, name, data = [] }) {
  return (
    <div>
      <h1 className='text-lg font-bold mb-6 mt-8'>{title}</h1>

      <input type='hidden' name={`${name}[]`} value='' />

      <div className='grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 max-w-3xl'>
        {strArr.map((str) => (
          <Checkbox lbl={str} name={`${name}[]`} key={str} value={str} defaultChecked={data?.[name]?.includes(str)} />
        ))}
      </div>
    </div>
  )
}
