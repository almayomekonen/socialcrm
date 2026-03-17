import Icon from '../Icon'
import { ConfigT } from '.'
import { formatFuncs, getNestedValue } from './funcs'

export default function TBody({ config }: { config: ConfigT }) {
  if (config.skeleton) return <Skeleton config={config} />

  const { columns, noCheckboxs, state, moreRows, withIndex } = config
  const funcs = { ...formatFuncs, ...config.funcs }

  function getCell(item: any, col: ConfigT['columns'][number]) {
    const value = getNestedValue(item, col.key)
    if (col.format == 'img') return <img src={value} alt='' className='size-10 rounded' />
    if (col.format) return funcs[col.format](value, item, col)
    if (typeof value == 'boolean') return value ? <Icon name='check' /> : <Icon name='xmark' className='size-4' />

    return value
  }

  return (
    <tbody className={config.clsBody || ''}>
      {state.map((item, index) => (
        <tr
          key={index}
          onClick={() => config.onRowClick?.(item)}
          className={`${config.onRowClick && 'cursor-pointer'} ${config.addTrCls && config.addTrCls(item)}`}
        >
          {!noCheckboxs && (
            <td>
              <input type='checkbox' name='checkRow' id={item.id} />
            </td>
          )}
          {withIndex && <td>{index + 1 + '#'}</td>}
          {columns.map((col, i) => {
            if (col.noShow) return null
            return (
              <td
                key={col.key + i}
                className='truncate max-w-64'
                title={typeof getCell(item, col) == 'string' ? getCell(item, col) : ''}
              >
                {getCell(item, col)}
              </td>
            )
          })}

          {moreRows && moreRows(item, index)}
        </tr>
      ))}
    </tbody>
  )
}

function Skeleton({ config }: { config: ConfigT }) {
  const { columns, noCheckboxs, state, withIndex } = config
  return (
    <tbody>
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((index) => (
        <tr key={index}>
          {!noCheckboxs && (
            <td>
              <input type='checkbox' />
            </td>
          )}
          {withIndex && <td>{index + 1 + '#'}</td>}
          {columns.map((col, i) => {
            if (col.noShow) return null
            return (
              <td key={col.key + i} className='truncate max-w-64 text-gray-500'>
                - - - - - - - -
              </td>
            )
          })}
        </tr>
      ))}
    </tbody>
  )
}

// function Skeleton({ columns }) {
//   return (
//     <tbody>
//       {columns.map((col, i) => {
//         if (col.noShow) return null
//         return (
//           <td key={col.key + i} className='truncate max-w-64'>
//             - - - - - - - -
//           </td>
//         )
//       })}
//     </tbody>
//   )
// }
