export function removeSqlField(sql: any, fields: string[]) {
  if (sql['_statements']) {
    sql['_statements'] = sql['_statements'].filter((s: any) => !fields.includes(s.column))
  }
  return sql
}

// השוואה לתקופה קודמת
// export function offrDtYearBefore(sql) {
//   const queryBuilder = sql.sql || sql

//   const clonedSql = queryBuilder.clone()
//   const statements = clonedSql._statements || []

//   const whereBetweenIndex = statements.findIndex(
//     (stmt: any) => stmt.grouping === 'where' && stmt.type === 'whereBetween' && stmt.column === 'offrDt'
//   )

//   if (whereBetweenIndex !== -1) {
//     const whereBetweenStmt = statements[whereBetweenIndex]
//     const [startDate, endDate] = whereBetweenStmt.value

//     const shiftedStart = new Date(startDate)
//     shiftedStart.setFullYear(shiftedStart.getFullYear() - 1)
//     const shiftedEnd = new Date(endDate)
//     shiftedEnd.setFullYear(shiftedEnd.getFullYear() - 1)

//     statements.splice(whereBetweenIndex, 1)

//     clonedSql.whereBetween('offrDt', [shiftedStart.toISOString().split('T')[0], shiftedEnd.toISOString().split('T')[0]])
//   }

//   return clonedSql
// }

// export function hasOffrDtWhereBetween(sql: any): boolean {
//   const queryBuilder = sql.sql || sql
//   const statements = queryBuilder._statements || []

//   return statements.some(
//     (stmt: any) =>
//       stmt.column === 'offrDt' ||
//       (stmt.grouping === 'where' && stmt.column === 'offrDt') ||
//       (stmt.type === 'whereBetween' && stmt.column === 'offrDt')
//   )
// }
