import { Check } from 'lucide-react';

import Noise from '@/components/lumen/noise';
import { Card, CardContent, CardHeader } from '@/components/lumen/ui/card';
import { FLAT_PRICE } from '@/lib/marketing/copy/pricingPage';

/**
 * `/pricing` only: why one price covers the whole workspace, and what it
 * includes. Server Component, so the text is in the HTML. Heading scale,
 * container and the check-list markup are the ones `faq-section` and
 * `pricing` already use.
 */
export default function PricingExplainer() {
  return (
    <section className="section-padding relative">
      <Noise />
      <div className="container grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <h2 className="text-4xl leading-tight tracking-tight lg:text-5xl">{FLAT_PRICE.title}</h2>
          {FLAT_PRICE.paragraphs.map((p) => (
            <p key={p} className="text-muted-foreground text-base leading-relaxed md:text-lg">
              {p}
            </p>
          ))}
        </div>
        <Card className="h-full gap-4">
          <CardHeader>
            <h3 className="text-2xl">{FLAT_PRICE.included.title}</h3>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {FLAT_PRICE.included.items.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="border-muted-foreground mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border-[0.5px]">
                    <Check className="text-muted-foreground size-2" />
                  </span>
                  <span className="text-sm">{item}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
