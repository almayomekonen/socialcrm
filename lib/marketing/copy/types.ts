/**
 * The shape of the homepage copy, one slice per component.
 *
 * `he.ts` holds the live Hebrew and is every section's default, so a Hebrew page
 * passes no copy at all and its RSC payload and bundle never see English.
 * `en.ts` is typed against this, so a missing string fails the type check.
 *
 * Strings only, because each slice crosses the server/client boundary as a prop.
 * Icons, images and mockups stay in the components, matched by array position.
 */

export type Dir = 'rtl' | 'ltr'

export interface NavCopy {
  dir: Dir
  logoHref: string
  product: {
    label: string
    subitems: ReadonlyArray<{ label: string; href: string; description: string }>
  }
  /**
   * `lang` marks a link whose text and target are in another language (the
   * language switch); it sets both `lang` and `hreflang` on the anchor.
   */
  links: ReadonlyArray<{ label: string; href: string; lang?: string }>
  login: { label: string; href: string }
  trial: { label: string; href: string }
}

export interface FooterCopy {
  dir: Dir
  logoHref: string
  sections: ReadonlyArray<{
    title: string
    links: ReadonlyArray<{ name: string; href: string; hrefLang?: string }>
  }>
  social: { facebook: string; instagram: string; email: string }
  phoneLabel: string
  /** Set where the page is not in the language of the published address. */
  addressLang?: { lang: string; dir: Dir }
  copyright: string
  copyrightHref: string
  privacy: string
  terms: string
  legalHrefLang?: string
}

export interface HeroCopy {
  titleLine1: string
  titleLine2: string
  subtitle: string
  cta: string
  imageAlt: string
  /** Shown under the sign-up button where the app is not in the page's language. */
  languageNote?: string
}

export interface LogosCopy {
  lead: string
  websiteLabel: string
  websiteUrl: string
  websiteDir: Dir
}

export interface FeaturesCarouselCopy {
  dir: Dir
  titleLead: string
  titleTail: string
  subtitle: string
  items: ReadonlyArray<{ title: string; description: string }>
  /** Language of the product mockups, where it differs from the page's. */
  mockupLang?: string
}

export interface FeaturesGridCopy {
  title: string
  subtitle: string
  items: ReadonlyArray<{ imageAlt: string; title: string; description: string }>
}

export interface FeaturesShowcaseCopy {
  title: string
  subtitle: string
  items: ReadonlyArray<{ title: string; description: string }>
  mockupLang?: string
}

export interface FaqSectionCopy {
  title: string
  items: ReadonlyArray<{ id: string; question: string; answer: string }>
  cardTitle: string
  cardBodyBeforeDays: string
  cardBodyAfterDays: string
  cardCta: string
  cardCtaHref: string
}

export interface PricingPlanCopy {
  title: string
  subtitle: string
  description: string
  priceSuffix: string
  features: ReadonlyArray<string>
  ctaText: string
  ctaButton: string
}

export interface PricingCopy {
  titleLine1: string
  titleLine2: string
  subtitleAfterDays: string
  recommended: string
  talkToUs: string
  dir: Dir
  logoHref: string
  plans: { individual: PricingPlanCopy; team: PricingPlanCopy }
}

export interface HomeCopy {
  nav: NavCopy
  hero: HeroCopy
  logos: LogosCopy
  featuresCarousel: FeaturesCarouselCopy
  featuresGrid: FeaturesGridCopy
  featuresShowcase: FeaturesShowcaseCopy
  faq: FaqSectionCopy
  pricing: PricingCopy
  footer: FooterCopy
}
