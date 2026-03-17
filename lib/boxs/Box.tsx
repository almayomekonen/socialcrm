import { twMerge } from 'tailwind-merge'
import { CopyBtn } from '../btns/CopyBtn'

export function Box({ lbl, val, valClassName = '', lblClassName = '', className = '', copy = false, side = false, url = false }) {
  if (!val || val.toString().trim() == '-') return null

  let displayVal = val
  let cutVal = false
  if (val.length > 25) {
    displayVal = val.slice(0, 25) + '...'
    cutVal = true
  }

  return (
    <div className={twMerge('bg-white p-4 border rounded-lg flex justify-between items-start max-w-xs  ', className)}>
      <div className={side ? 'flex justify-center' : ''}>
        <p className={twMerge('font-semibold', lblClassName)}>{lbl}</p>
        <p className={valClassName}>
          {url ? (
            <a href={val} target='_blank'>
              {displayVal}
            </a>
          ) : (
            <span title={cutVal ? val : ''}>{displayVal}</span>
          )}
        </p>
      </div>
      {copy && <CopyBtn val={val} />}
    </div>
  )
}
