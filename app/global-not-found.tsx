import RootLayout from './(he)/layout'
import NotFound from 'next/dist/client/components/builtin/not-found'
import { metaData } from '@/types/vars'
import type { Metadata } from 'next'

/**
 * The 404 for URLs that match no route.
 *
 * The site has one root layout per language (`(he)`, `(en)`, `(ar)`), so there
 * is no top-level layout for Next to render its default 404 inside. Without
 * this file Next serves a bare document with no `lang`, no styles and none of
 * the Hebrew shell. This renders the page visitors got before the split: Next's
 * own default not-found UI inside the unchanged Hebrew root layout.
 */
// The Hebrew layout's metadata with Next's own 404 title. Without the title
// override the tab reads "SocialCRM" once the page hydrates, where the old 404
// kept "404: This page could not be found."; Next still adds `noindex` itself.
export const metadata: Metadata = { ...metaData, title: '404: This page could not be found.' }

export default function GlobalNotFound() {
  return (
    <RootLayout>
      <NotFound />
    </RootLayout>
  )
}
