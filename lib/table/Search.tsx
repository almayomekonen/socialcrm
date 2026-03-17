import { Input } from '../form'
import { ConfigT } from '.'

export default function Search({ config }: SearchT) {
  const { data, columns, setState } = config

  function onTermChange(e) {
    const term = e.target.value
    const filtered = data.filter((item) => columns.some((col) => item[col.key]?.toString().includes(term)))
    setState(filtered)
  }

  return <Input placeholder='🔎︎  חיפוש חופשי...' onChange={onTermChange} />
}

type SearchT = {
  config: ConfigT
}
