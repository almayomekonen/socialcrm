import { Suspense } from 'react'
import { JsonLd } from '@/components/seo/JsonLd'
import { ShellFrame } from '@/components/marketing/system/ShellChrome'
import { organizationSchema, softwareApplicationSchema, websiteSchema } from '@/lib/seo/schemas'
import AttributionCapture from '@/components/analytics/AttributionCapture'

/**
 * The marketing shell.
 *
 * Header and footer live HERE, not in each page. Mounting the header per page
 * is how `/privacy`, `/terms` and `/data-deletion` ended up with no navigation
 * at all — three indexed pages that were dead ends for readers and for internal
 * links.
 *
 * `mkt-ground-light` on the root gives every descendant a resolved ground, so a
 * section that forgets to declare one inherits a matched foreground rather than
 * painting dark text on a dark background (the 1.03:1 defect). Sections
 * override freely with their own `<Section ground=…>`.
 *
 * The three site-wide JSON-LD graphs are unchanged.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div lang='he' dir='rtl' data-scroll-behavior='smooth' className='mkt-ground-light'>
      <JsonLd data={organizationSchema()} />
      <JsonLd data={softwareApplicationSchema()} />
      <JsonLd data={websiteSchema()} />
      {/* Records the campaign/referrer that brought this visitor, for the
          registration they may complete later. Renders nothing; writes one
          cookie. Mounted on the shell so every marketing entry point is
          covered, including the legal pages people land on from ads. */}
      <AttributionCapture />
      {/* `ShellFrame` owns header, <main> and footer together: the Lumen shell
          wraps all three in one `.lumen` div, which a header/footer pair
          rendered as separate siblings could not express. */}
      <Suspense>
        <ShellFrame>{children}</ShellFrame>
      </Suspense>
    </div>
  )
}
