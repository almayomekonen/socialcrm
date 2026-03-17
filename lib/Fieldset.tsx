import { twMerge } from 'tailwind-merge'

export default function Fieldset({ children, legend, className }) {
  return (
    <fieldset className={twMerge('border rounded-md p-4', className)}>
      <legend className='bg-gray-200/70 px-2 py-1 rounded-md text-sm font-semibold'>{legend}</legend>
      {children}
    </fieldset>
  )
}
