import Link from 'next/link';

import Noise from '@/components/lumen/noise';
import { Button } from '@/components/lumen/ui/button';
import type { LandingLink, LandingSection } from '@/lib/marketing/landing/types';

/**
 * The body of an SEO landing page in the current (Lumen) design: the same
 * `section-padding` rhythm, `container`, heading scale and `link` button the
 * homepage sections use. Server Component, so every word is in the HTML.
 */
export default function LandingArticle({
  lead,
  sections,
  related,
}: {
  /** Intro paragraphs after the first one (which the hero shows). */
  lead: readonly string[];
  sections: readonly LandingSection[];
  /** The other landing pages, linked with descriptive text. */
  related: readonly LandingLink[];
}) {
  return (
    <section className="section-padding relative">
      <Noise />
      <div className="container max-w-3xl space-y-14">
        {lead.length > 0 && (
          <div className="space-y-4">
            {lead.map((p) => (
              <p key={p} className="text-muted-foreground text-lg leading-relaxed">
                {p}
              </p>
            ))}
          </div>
        )}
        {sections.map((section) => (
          <div key={section.h2} className="space-y-4">
            <h2 className="text-3xl leading-tight font-semibold tracking-tight lg:text-4xl">{section.h2}</h2>
            {section.paragraphs.map((p) => (
              <p key={p} className="text-muted-foreground text-lg leading-relaxed">
                {p}
              </p>
            ))}
            {section.bullets && (
              <ul className="text-muted-foreground list-disc space-y-3 ps-6 text-lg leading-relaxed">
                {section.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
            {section.links && <LinkRow links={section.links} />}
          </div>
        ))}
        {related.length > 0 && (
          <div className="space-y-4 border-t pt-10">
            <h2 className="text-2xl leading-tight font-semibold tracking-tight">עוד על ניהול לידים ב-SocialCRM</h2>
            <LinkRow links={related} />
          </div>
        )}
      </div>
    </section>
  );
}

function LinkRow({ links }: { links: readonly LandingLink[] }) {
  return (
    <ul className="flex flex-wrap gap-x-6 gap-y-2">
      {links.map((l) => (
        <li key={l.href}>
          <Button variant="link" className="h-auto p-0 text-base font-semibold" asChild>
            <Link href={l.href} hrefLang={l.hrefLang}>
              {l.label}
            </Link>
          </Button>
        </li>
      ))}
    </ul>
  );
}
