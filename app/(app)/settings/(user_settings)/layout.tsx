import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'הגדרות אישיות',
}

// The 24px above the page title is the settings chrome's job, not this group's
// — it used to live here, which is why user pages sat 24px lower than admin ones.
export default async function UserSettingsLayout({ children }) {
  return children
}
