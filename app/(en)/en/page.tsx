import type { Metadata } from 'next'

/** Placeholder until the English pages exist: not indexed, not linked, not in the sitemap. */
export const metadata: Metadata = {
  title: 'SocialCRM',
  robots: { index: false, follow: false },
}

export default function EnglishPlaceholder() {
  return (
    <main id='main-content'>
      <h1>SocialCRM</h1>
    </main>
  )
}
