import Link from 'next/link'

type Breadcrumb = { label: string; href: string }
type CTA = { label: string; href: string }

type HeroProps = {
  breadcrumbs?: Breadcrumb[]
  badge?: string
  title: string
  subtitle: string
  cta: CTA
  secondaryCta?: CTA
}

export function Hero({ breadcrumbs, badge, title, subtitle, cta, secondaryCta }: HeroProps) {
  return (
    <section className='py-20 px-8 text-center' style={{ backgroundColor: '#f3f2ff' }}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label='breadcrumb' className='text-sm text-gray-400 mb-6'>
          {breadcrumbs.map((crumb, i) => (
            <span key={crumb.href}>
              {i > 0 && <span className='mx-2'>/</span>}
              {i < breadcrumbs.length - 1 ? (
                <Link href={crumb.href} className='hover:underline'>
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current='page'>{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      {badge && (
        <span
          className='inline-block px-3 py-1 rounded-full text-xs font-semibold mb-4 text-white'
          style={{ backgroundColor: '#3f20f5' }}
        >
          {badge}
        </span>
      )}
      <h1 className='text-4xl lg:text-5xl font-bold mb-4 leading-tight' style={{ color: '#171424' }}>
        {title}
      </h1>
      <p className='text-gray-500 text-lg max-w-2xl mx-auto mb-8 leading-relaxed'>{subtitle}</p>
      <div className='flex flex-wrap gap-3 justify-center'>
        <Link
          href={cta.href}
          className='inline-block px-8 py-3 rounded-lg text-white font-semibold text-lg'
          style={{ backgroundColor: '#3f20f5' }}
        >
          {cta.label}
        </Link>
        {secondaryCta && (
          <Link
            href={secondaryCta.href}
            className='inline-block px-8 py-3 rounded-lg font-semibold text-lg border border-solid'
            style={{ borderColor: '#3f20f5', color: '#3f20f5' }}
          >
            {secondaryCta.label}
          </Link>
        )}
      </div>
    </section>
  )
}
