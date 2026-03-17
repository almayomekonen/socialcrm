export default function InputCheckbox({ lbl, ...props }: Props) {
  return (
    <label className='has-[:checked]:bg-solid/5 flex flex-nowrap items-center gap-4 h-10 cursor-pointer bg-white px-4 py-2 rounded-md border border-gray-200 w-auto'>
      <input type='checkbox' {...props} className='size-4 accent-solid' />
      <p className='whitespace-nowrap'>{lbl}</p>
    </label>
  )
}

type Props = {
  lbl: string
} & React.InputHTMLAttributes<HTMLInputElement>
