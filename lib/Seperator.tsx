import { twMerge } from 'tailwind-merge'

export function Seperator({ className }: { className?: string }) {
  return <div className={twMerge('border-b w-full my-4', className)} />
}
