export default function SimpleTable({ columns, data, className = '' }) {
  return (
    <div className={`tbl ${className}`}>
      <table>
        <thead className='tblHead'>
          <tr>
            {columns.map((col) => (
              <th key={col.label}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className='tblBody'>
          {data.map((row) => (
            <tr key={row.id}>
              {columns.map((col) => (
                <td key={col.label} className={col.className || ''}>
                  {col.render ? col.render(row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
