import { Input } from '../form'
import { ConfigT } from '.'
import { useT } from '@/lib/i18n/I18nProvider'

export default function Search({ config }: SearchT) {
  const t = useT()
  const { data, columns, setState } = config

  function onTermChange(e) {
    const term = e.target.value
    const filtered = data.filter((item) => columns.some((col) => item[col.key]?.toString().includes(term)))
    setState(filtered)
  }

  return <Input placeholder={t('common.table.freeSearch')} onChange={onTermChange} />
}

type SearchT = {
  config: ConfigT
}
