import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import Noise from '@/components/lumen/noise';
import { Button } from '@/components/lumen/ui/button';
import { TRIAL_CTA_LABEL } from '@/lib/pricing';
import { TRIAL_TERMS_LINE } from '@/lib/marketing/landing/types';

/**
 * Closing call to action for an SEO landing page. The button is the hero's
 * (same size, radius and chevron) and the trial terms sit right under it, as on
 * every landing-page CTA.
 */
export default function LandingCta({ title, highlight }: { title: string; highlight: string }) {
  return (
    <section className="section-padding relative">
      <Noise />
      <div className="container text-center">
        <h2 className="text-4xl leading-tight tracking-tight text-balance lg:text-5xl">
          {title}
          <span className="text-muted-foreground block">{highlight}</span>
        </h2>
        <Button asChild size="lg" className="mt-8 rounded-full !ps-5.5 before:rounded-full">
          <Link href="/auth/register">
            {TRIAL_CTA_LABEL}
            <div className="bg-background/15 border-background/10 grid size-5.5 place-items-center rounded-full border">
              <ChevronRight className="size-4 rtl:rotate-180" />
            </div>
          </Link>
        </Button>
        <p className="text-muted-foreground mt-4 text-sm">{TRIAL_TERMS_LINE}</p>
      </div>
    </section>
  );
}
