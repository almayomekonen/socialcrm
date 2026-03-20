import fs from 'fs'
import * as XLSX from 'xlsx'

async function run() {
  const file = fs.readFileSync('./scripts/sales.xlsx')
  const data = await uploadClientData(file)
  console.log('done')
  fs.writeFileSync('./scripts/sales.json', JSON.stringify(data, null, 2))

  const jsonContent = fs.readFileSync('./scripts/sales.json', 'utf8')
  const salesData = JSON.parse(jsonContent)

  // Convert to TypeScript format
  const tsContent = `export const salesData = ${JSON.stringify(salesData, null, 2)} as any[]`

  // Write to salesdata.ts file
  fs.writeFileSync('./components/sales/salesdata.ts', tsContent)
}

run()

export async function uploadClientData(file) {
  const workbook = XLSX.read(file, { type: 'buffer' })
  const firstSheetName = workbook.SheetNames[0]
  const worksheet = workbook.Sheets[firstSheetName]
  const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 })

  let headers = jsonData[0] as string[]
  headers = headers.map((header) => header.trim())

  headers = headers.map((header) => {
    if (header == 'תאריך תחילה') return 'saleDt'
    if (header == 'חודש מכירה') return 'offrDt'
    if (header == 'חודש סיום פוליסה') return 'polisaEndDt'
    if (header == 'סטטוס') return 'prdctType'
    if (header == 'חידוש אוטומטי') return 'renew'
    if (header == 'שם משפחה') return 'lastName'
    if (header == 'שם פרטי') return 'firstName'
    if (header == 'ת"ז/ח.פ') return 'idNum'
    if (header == 'חברה') return 'company'
    if (header == 'מספר פוליסה') return 'polisaNum'
    if (header == 'סוג המוצר') return 'prdct'
    if (header == 'שם נציג') return 'leadSource'
    if (header == 'שם המטפל') return 'handlerId'
    return header
  })

  const dataRows = jsonData.slice(1) as any[][]
  let arr = []

  for (let i = 0; i < 2325; i++) {
    const row = dataRows[i]
    if (row?.length) {
      const rowObject = {} as any
      console.log(i)

      headers.forEach((header, index) => {
        rowObject[header] = row[index]
        if (header === 'lastName') console.log(rowObject[header])

        if (header === 'saleDt') rowObject[header] = toDate(rowObject[header])
        if (header === 'offrDt') rowObject[header] = fromMonthToDate(rowObject[header])
        if (header === 'polisaEndDt') rowObject[header] = fromMonthToDate(rowObject[header])
        if (header === 'renew') rowObject[header] = formatRenew(rowObject[header])
        if (header === 'polisaNum') rowObject[header] = String(rowObject[header])
        if (header === 'lastName') rowObject[header] = rowObject[header] ? rowObject[header].trim() : ''
        if (header === 'firstName') {
          if (rowObject[header]) {
            rowObject[header] = rowObject[header].trim()
          } else {
            rowObject[header] = rowObject['lastName']
            rowObject['lastName'] = ''
          }
        }

        if (header === 'idNum') rowObject[header] = Number(rowObject[header])
        if (header === 'leadSource') rowObject[header] = rowObject[header].trim()

        if (header === 'handlerId') rowObject[header] = nameToId(rowObject[header])
        rowObject['userId'] = 33
      })

      if (rowObject.prdct && rowObject.prdct.includes('+')) {
        const cleanedPrdct = rowObject.prdct.replaceAll(' ', '')

        if (cleanedPrdct === 'מבנה+תכולה' || cleanedPrdct === 'תכולה+מבנה') {
          const duplicatedRow = { ...rowObject }
          duplicatedRow.prdct = 'דירה מבנה ורכוש'
          arr.push(duplicatedRow)
        } else {
          // For other combinations with +, split as before
          const prdcts = rowObject.prdct.split('+')
          if (rowObject['ריידרים']) prdcts.push('ריידרים')

          prdcts.forEach((prdct) => {
            const duplicatedRow = { ...rowObject }
            duplicatedRow.prdct = prdct.trim()
            arr.push(duplicatedRow)
          })
        }
      } else if (rowObject.prdct) {
        const trimmedPrdct = rowObject.prdct.trim()
        const duplicatedRow = { ...rowObject }

        switch (trimmedPrdct) {
          case 'תכולה':
            duplicatedRow.prdct = 'דירה ורכוש'
            break
          case 'מבנה משכנתא':
            duplicatedRow.prdct = 'דירה מבנה משכנתא'
            break
          case 'פוליסת עסק':
            duplicatedRow.prdct = 'עסק'
            break
          default:
            duplicatedRow.prdct = trimmedPrdct
            break
        }

        arr.push(duplicatedRow)
      } else {
        arr.push(rowObject)
      }
    }
  }
  // Add amount property based on product type
  arr.forEach((item) => {
    switch (item.prdct) {
      case 'מקיף':
        item.amount = item['פרמיה רכב']
        break
      case 'חובה':
        item.amount = item['פרמיה חובה']
        break
      case 'ריידרים':
        item.amount = item['ריידרים']
        break
      case 'דירה מבנה משכנתא':
        item.amount = item['פרמיה דירה']
        break
      case 'עסק':
        item.amount = item['פרמיה עסקים']
        break
      case 'צד ג':
        item.amount = item['פרמיה רכב']
        break
      case 'דירה מבנה ורכוש':
        item.amount = item['פרמיה דירה']
        break
      case 'אחריות מקצועית':
        item.amount = item['פרמיה עסקים']
        break
      case 'בית משותף':
        item.amount = item['פרמיה דירה']
        break
      case 'מבנה':
        item.amount = item['פרמיה דירה']
        break
      default:
        item.amount = undefined
        break
    }
    delete item['פרמיה חו"ל']
    delete item['פרמיה רכב']
    delete item['פרמיה חובה']
    delete item['ריידרים']
    delete item['פרמיה דירה']
    delete item['פרמיה עסקים']
    delete item['פרמיה רכב']
    delete item['פרמיה דירה']
  })

  arr = arr.map((item) => {
    return {
      users: {
        userId: item.userId,
      },
      action: 'מכירה',
      offrDt: item.offrDt,
      handlerId: item.handlerId,
      leadSource: item.leadSource,
      renew: item.renew || null,
      client: {
        firstName: item.firstName,
        lastName: item.lastName,
        idNum: item.idNum,
      },
      prdcts: [
        {
          company: item.company,
          branch: 'אלמנטרי',
          prdct: item.prdct,
          prdctType: item.prdctType,
          amount: item.amount,
          status: 'הופק',
          saleDt: item.saleDt,
          polisaNum: item.polisaNum,
          polisaEndDt: item.polisaEndDt,
        },
      ],
    }
  })
  return arr
}

function toDate(serial) {
  const excelEpoch = new Date(1900, 0, 1) // Jan 1, 1900
  const jsDate = new Date(excelEpoch.getTime() + (serial - 2) * 24 * 60 * 60 * 1000)
  return jsDate
}

function fromMonthToDate(monthName) {
  const months = {
    ינואר: 0,
    פברואר: 1,
    מרץ: 2,
    אפריל: 3,
    מאי: 4,
    יוני: 5,
    יולי: 6,
    אוגוסט: 7,
    ספטמבר: 8,
    אוקטובר: 9,
    נובמבר: 10,
    דצמבר: 11,
  }

  const year = new Date().getFullYear()
  const monthIndex = months[monthName]

  if (monthIndex === undefined) {
    throw new Error('שם חודש לא מוכר: ' + monthName)
  }
  return new Date(Date.UTC(year, monthIndex, 1))
}

function formatRenew(value) {
  if (value) return 'on'
}

function nameToId(name) {
  switch (name) {
    case 'רון':
      return 162
    case 'עדן':
      return 163
    case 'רויטל':
      return 165
    case 'לינוי':
      return 204
    case 'חן':
      return 164
  }
}
