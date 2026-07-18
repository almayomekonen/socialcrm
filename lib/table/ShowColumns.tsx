import { MultiSelectSearch } from '../form/MultiSelectSearch'

export default function ShowColumns({ config }) {
  const { columns, setColumns } = config

  function onOpt(opt) {
    const tmp = [...columns]
    tmp.find((item) => item.key === opt.key).noShow = !opt.noShow
    setColumns(tmp)

    config.getColumns && config.getColumns(tmp)
  }

  const options = config.hiddenKeys?.size ? columns.filter((item) => !config.hiddenKeys.has(item.key)) : columns
  const selected = options.filter((item) => !item.noShow).map((item) => item.key)


  const availabilityKey = config.hiddenKeys ? Array.from(config.hiddenKeys).sort().join(',') : ''

  return (
    <MultiSelectSearch
      key={availabilityKey}
      show='label'
      val='key'
      selected={selected}
      options={options}
      onSelectOpt={onOpt}
      lbl='עמודות לצפיה'
    />
  )
}
