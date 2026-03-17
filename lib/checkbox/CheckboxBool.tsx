import { Checkbox } from '@/lib/form'

export function CheckboxBool({ lbl, name, defaultChecked = null, onChange = null }) {
  return (
    <div>
      <input type='hidden' value='false' name={name} />
      <Checkbox lbl={lbl} name={name} defaultChecked={defaultChecked} onChange={onChange} />
    </div>
  )
}
