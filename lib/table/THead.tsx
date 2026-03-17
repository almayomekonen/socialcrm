import { ConfigT } from '.'
import { useState } from 'react'
import { onCheckAll, sortTable } from './funcs'
import Icon from '../Icon'

let dragIndex: number, enterIndex: number

export default function THead({ config }: { config: ConfigT }) {
  const { columns, noCheckboxs, setState, data, moreHeads, withIndex, setColumns } = config
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: null, direction: 'asc' })

  function onSort(key) {
    const direction = sortConfig.direction === 'asc' ? 'desc' : 'asc'
    const sorted = sortTable(key, direction, data)
    setState([...sorted])
    setSortConfig({ key, direction })
  }

  function onDragEnd() {
    let tmp = [...columns] as any
    const _dragItem = tmp.splice(dragIndex, 1)[0]
    tmp.splice(enterIndex, 0, _dragItem)
    setColumns(tmp)

    config.getColumns && config.getColumns(tmp)
  }

  return (
    <thead className='sticky top-0 z-50'>
      <tr className='tblHead'>
        {!noCheckboxs && (
          <th>
            <div className='flex'>
              <input type='checkbox' id='checkAll' onClick={onCheckAll} />
            </div>
          </th>
        )}
        {withIndex && <th></th>}

        {columns.map((col, i) => {
          if (col.noShow) return null
          return (
            <th
              key={col.key + i}
              onClick={() => onSort(col.key)}
              className={`cursor-move ${config.clsHead || ''}`}
              draggable
              onDragStart={() => (dragIndex = i)}
              onDragEnter={() => (enterIndex = i)}
              onDragEnd={onDragEnd}
              onDragOver={(e) => e.preventDefault()}
            >
              <span className='flex gap-2 flex-nowrap'>
                {col.label}

                <Icon
                  type='reg'
                  name={sortConfig.direction === 'asc' ? 'arrow-down-short-wide' : 'arrow-up-wide-short'}
                  className={`size-3.5 bg-gray-700 ${sortConfig.key === col.key ? 'opacity-100' : 'opacity-0'}`}
                />
              </span>
            </th>
          )
        })}
        {moreHeads && moreHeads()}
      </tr>
    </thead>
  )
}

type SortConfig = {
  key: string | null
  direction: 'asc' | 'desc'
}
