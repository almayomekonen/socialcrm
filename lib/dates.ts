export function toInputDate(date) {
  if (!date) return null
  date = new Date(date)
  return date.toLocaleDateString('en-CA')
}

export function formatDate(dt) {
  if (!dt) return ''

  const parsedDate = Date.parse(dt)
  if (isNaN(parsedDate)) return dt
  if (typeof dt === 'string') dt = new Date(dt)

  return new Intl.DateTimeFormat('he-IL').format(dt).replaceAll('.', '/')
}

export function formatDateTime(dt) {
  if (!dt) return dt
  const parsedDate = Date.parse(dt)
  if (isNaN(parsedDate)) return dt
  if (typeof dt === 'string') dt = new Date(dt)

  return new Intl.DateTimeFormat('he-IL', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
    .format(dt)
    .replaceAll('.', '/')
}

export function toIso(date) {
  if (!date) return null
  const d = new Date(date)
  if (isNaN(d.getTime())) return null
  return d.toISOString()
}

export function startOfMonth() {
  const dt = new Date()
  return new Date(dt.getFullYear(), dt.getMonth(), 2).toISOString().split('T')[0]
}

export function endOfMonth() {
  const dt = new Date()
  return new Date(dt.getFullYear(), dt.getMonth() + 1, 0).toISOString().split('T')[0]
}

export function daysFromNow(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date
}

export function getDateRange(period: Period): { start: Date; end: Date } | false {
  const today = new Date()
  let start: Date, end: Date

  switch (period) {
    case 'החודש הנוכחי':
      start = new Date(today.getFullYear(), today.getMonth(), 1)
      end = new Date(today.getFullYear(), today.getMonth() + 1, today.getDate() + 1)
      break
    case 'החודש הקודם':
      start = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      end = new Date(today.getFullYear(), today.getMonth(), 0)
      break
    case 'השבוע הנוכחי':
      start = new Date(today)
      start.setDate(today.getDate() - today.getDay())
      end = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay() + 7)
      break
    case 'השבוע הקודם':
      start = new Date(today)
      start.setDate(today.getDate() - today.getDay() - 7)
      end = new Date(today)
      end.setDate(today.getDate() - today.getDay() - 1)
      break
    case 'השנה הנוכחית':
      start = new Date(today.getFullYear(), 0, 1)
      end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
      break
    case 'השנה הקודמת':
      start = new Date(today.getFullYear() - 1, 0, 1)
      end = new Date(today.getFullYear() - 1, 11, 31)
      break
    default:
      return false
  }

  return { start, end }
}

// type Period = 'this month' | 'last month' | 'this week' | 'last week' | 'this year' | 'last year'
export type Period = 'החודש הנוכחי' | 'החודש הקודם' | 'השבוע הנוכחי' | 'השבוע הקודם' | 'השנה הנוכחית' | 'השנה הקודמת'

// dates, age funcs

export function addHodashim(num) {
  if (!num) return null
  return `${num} חודשים`
}

export function formatDateAge(date) {
  if (!date) return ''
  else return `${formatDate(date)} (${getAge(date)})`
}

function getAge(birthDate) {
  if (!birthDate) return ''
  const today = new Date()
  const age = today.getFullYear() - birthDate.getFullYear()
  return age
}

export function toHebrewDate(dateStr) {
  const months = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']

  const date = new Date(dateStr)
  const day = date.getDate()
  const monthName = months[date.getMonth()]

  return `${day} ${monthName}`
}

export const todayString = new Date().toLocaleDateString('he-IL', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export const yearMonthsPassed = new Date().getMonth() + 1

export const getYearDaysPassed = () => {
  const firstDay = new Date(new Date().getFullYear(), 0, 1) as any
  return Math.round((Date.now() - firstDay) / (1000 * 60 * 60 * 24))
}
