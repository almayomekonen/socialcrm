/**
 * Lead detail (`/clients/[clientId]`) — page chrome, header and tab nav.
 * Hebrew copied verbatim from the components it came from.
 */
export const page = {
  title: 'נתוני ליד',
  description: 'כל נתוני הליד',
  notFound: 'ליד זה לא נמצא',
} as const

export const header = {
  handler: 'אחראי ליד:',
  copied: '{text} הועתק ללוח',
  closeDeal: 'סגור עסקה',
} as const

export const nav = {
  summary: 'סיכום ליד',
  tasks: 'משימות',
  files: 'קבצים',
  billing: 'חיוב',
} as const
