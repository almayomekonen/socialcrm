import { Suspense } from 'react'
import Footer4Col from '@/components/ui/footer-column'
import { JsonLd } from '@/components/seo/JsonLd'
import { organizationSchema, softwareApplicationSchema, websiteSchema } from '@/lib/seo/schemas'

export default function MarketingLayout({ children }) {
  return (
    <div lang='he' dir='rtl' data-scroll-behavior='smooth'>
      <JsonLd data={organizationSchema()} />
      <JsonLd data={softwareApplicationSchema()} />
      <JsonLd data={websiteSchema()} />
      <Suspense>
        <main>{children}</main>
      </Suspense>
      <Footer4Col />
    </div>
  )
}
