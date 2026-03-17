import { MultiSelectSearch } from '../form/MultiSelectSearch'

export default function ShowColumns({ config }) {
  const { columns, setColumns } = config

  function onOpt(opt) {
    const tmp = [...columns]
    tmp.find((item) => item.key === opt.key).noShow = !opt.noShow
    setColumns(tmp)

    config.getColumns && config.getColumns(tmp)
  }

  const selected = columns.filter((item) => !item.noShow).map((item) => item.key)

  return <MultiSelectSearch show='label' val='key' selected={selected} options={columns} onSelectOpt={onOpt} lbl='עמודות לצפיה' />
}
