import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'הגדרות אישיות',
}

export default async function UserSettingsLayout({ children }) {
  return <div className='mt-6'>{children}</div>
}
