import { getUser } from '@/db/auth'
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'הגדרות אדמין',
}

export default async function AdminSettingsLayout({ children }) {
  const user = await getUser()
  if (user.role != 'ADMIN') return <div>אין לך הרשאה לצפות בדף זה</div>

  return children
}
