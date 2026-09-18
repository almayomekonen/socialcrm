'use client';

import { Check, ChevronRight, X } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useState } from 'react';

import Noise from '@/components/lumen/noise';
import { Badge } from '@/components/lumen/ui/badge';
import { Button } from '@/components/lumen/ui/button';
import { Card, CardContent, CardHeader } from '@/components/lumen/ui/card';
import { Switch } from '@/components/lumen/ui/switch';
import { cn } from '@/components/lumen/utils';

import Logo from '../layout/logo';
import { PRICING } from '@/lib/pricing';

/**
 * Two columns, one product. The left column is the seven-day trial, not a free
 * plan: an account without a verified card has NO product access
 * (lib/trial: NEVER_STARTED and TRIAL_EXPIRED both resolve to no access), so a
 * "free forever, no credit card" column would describe a state the system does
 * not have. Inside the trial the lead quota is bypassed entirely
 * (lib/quota assertLeadQuota → effective plan 'pro'), so the trial really is
 * the full product.
 *
 * Monthly only. Annual purchasing left with Payment Links.
 */
const pricingPlans = {
  individual: {
    title: 'שבעה ימי התנסות',
    subtitle: 'המערכת המלאה',
    description: 'נדרש כרטיס אשראי · לא מתבצע חיוב',
    monthlyPrice: 0,
    popular: false,
    features: [
      { name: 'כל מה שיש ב-Pro, שבעה ימים', included: true },
      { name: 'לידים ללא הגבלה', included: true },
      { name: 'חיבור לפייסבוק, אינסטגרם ווואטסאפ', included: true },
      { name: 'סטטוסים, נציגים ותאריכי מעקב', included: true },
      { name: 'ייבוא מאקסל, ייצוא לאקסל ו-PDF', included: true },
      { name: 'תקציר חכם ופעולה מומלצת', included: true },
      { name: 'טיוטות להודעות מעקב', included: true },
      { name: 'שאלות חופשיות על הליד', included: true },
    ],
    cta: { text: `בתום שבעה ימים ${PRICING.currency}${PRICING.monthly} לחודש · אפשר לבטל לפני החיוב הראשון`, button: 'להתחיל התנסות' },
  },
  team: {
    title: 'Pro',
    subtitle: 'כשהלידים מתחילים להצטבר',
    description: 'לעסק או לצוות מכירות',
    monthlyPrice: PRICING.monthly,
    popular: true,
    features: [
      { name: 'לידים ללא הגבלה', included: true },
      { name: 'תקציר חכם על כל ליד', included: true },
      { name: 'פעולה מומלצת עם הסיבה שלה', included: true },
      { name: 'טיוטות להודעות מעקב', included: true },
      { name: 'שאלות חופשיות על הליד', included: true },
      { name: 'שיוך לידים לנציגים', included: true },
      { name: 'חלוקת עמלות על עסקה משותפת', included: true },
      { name: 'מחיר אחד לסביבת העבודה', included: true },
    ],
    cta: { text: 'בלי תוספת לכל נציג · חיוב חודשי עד לביטול', button: 'שדרגו ל-Pro' },
  },
};


/**
 * `headingLevel` exists only so the dedicated `/pricing` route can own the
 * page's single <h1> while the homepage — which already has its own <h1> —
 * keeps this section at <h2>. Same classes, same copy: the tag is the only
 * difference, so nothing moves visually.
 */
export default function Pricing({ headingLevel = 'h2' }: { headingLevel?: 'h1' | 'h2' } = {}) {
  const Heading = headingLevel

  return (
    <section className="section-padding relative overflow-hidden">
      {/* Background Image with Mask */}
      <div className="absolute size-full mask-t-from-50% mask-t-to-100% mask-b-from-50% mask-b-to-90%">
        <div
          className={cn(
            'bg-chart-2 absolute size-full rounded-full blur-3xl will-change-transform',
            'top-0 left-0 -translate-y-1/3 md:-translate-x-1/3 md:translate-y-0',
          )}
        />
        <div
          className={cn(
            'bg-chart-3 absolute size-full rounded-full blur-3xl will-change-transform',
            'right-0 bottom-0 translate-y-1/3 md:top-0 md:translate-x-1/3 md:-translate-y-0',
          )}
        />
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="from-background/30 to-background/30 pointer-events-none absolute inset-0 z-[1] bg-gradient-to-b"
      />
      <div className="relative z-[2]">
        <Noise />
      </div>

      <div className="bigger-container relative z-10">
        {/* Section Header */}
        <div className="flex flex-col items-center justify-between gap-8 md:flex-row md:items-end">
          {/* Left side - Title and subtitle */}
          <div className="">
            <Heading className="text-center text-4xl font-semibold tracking-tighter md:text-start md:text-6xl md:leading-none lg:text-7xl">
              מתנסים שבוע במערכת המלאה, <br className="hidden md:block" />
              וממשיכים רק אם זה עובד לכם.
            </Heading>
            <p className="text-muted-foreground/70 mt-3 hidden text-lg leading-relaxed md:block lg:mt-4">
              שבעה ימים עם כל מה שיש במערכת, כולל ה-AI המלא. נדרש כרטיס אשראי
              כדי להתחיל, ולא מתבצע חיוב במהלך ההתנסות.
            </p>
          </div>

        </div>

        {/* Pricing Cards */}
        <div className="mx-auto mt-8 grid gap-4 lg:mt-12 lg:grid-cols-2">
          {Object.entries(pricingPlans).map(([key, plan]) => {
            /**
             * Free plan enters the registration funnel. The paid plan goes
             * through the retired-checkout shim, which is kept precisely
             * because it owns auth (anonymous → /auth) and lands a signed-in
             * visitor on the billing screen. Sending the paid CTA to /auth
             * instead is what made a signed-in visitor who clicked
             * "שדרגו ל-Pro" land on the dashboard with no way to buy. No
             * session is read here, so the marketing page stays static.
             *
             * No period is sent: this release sells monthly only.
             */
            const isFreePlan = key === 'individual'
            const upgradeHref = '/api/payments/upgrade?source=marketing_pricing'
            return (
            <Card
              key={key}
              className="bg-border hover:shadow-primary/5 h-full gap-4 p-3 transition-all duration-300 hover:shadow-lg md:p-6"
            >
              <CardHeader className="bg-card rounded-md p-4 md:p-6">
                {/* Header with title and badge */}
                <div className="flex items-start justify-between">
                  <h3 className="text-xl">{plan.title}</h3>
                  {plan.popular && (
                    <Badge className="rounded-none bg-[#FFE6D0] px-4 py-1 text-[#8A3600]">
                      התוכנית המומלצת
                    </Badge>
                  )}
                </div>

                {/* Subtitle and description */}
                <div className="mt-6 text-2xl md:mt-8 md:space-y-2 md:text-4xl">
                  <div className="text-muted-foreground/70">
                    {plan.subtitle}
                  </div>
                  <div className="font-semibold">{plan.description}</div>
                </div>

                {/* Price and contact section */}
                <div className="mt-8 flex flex-col justify-between gap-8 md:mt-10 md:flex-row">
                  {/* Left side - Price and main CTA */}
                  <div className="flex flex-1 flex-wrap justify-between gap-4 md:flex-col md:gap-8">
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-semibold">{PRICING.currency}</span>
                      <span className="text-5xl md:text-6xl">
                        {plan.monthlyPrice}
                      </span>
                      <span className="text-2xl">/לחודש</span>
                    </div>
                    <Button className="h-10 !pl-5.5" asChild>
                      {isFreePlan ? (
                        <Link href="/auth/register">
                          {plan.cta.button}
                          <div className="bg-background/15 border-background/10 grid size-5.5 place-items-center rounded-full border">
                            <ChevronRight className="size-4 rtl:rotate-180" />
                          </div>
                        </Link>
                      ) : (
                        /* Plain <a>, matching every other upgrade entry point:
                           this is a route handler that issues a redirect, not a
                           page for the client router to prefetch. */
                        <a href={upgradeHref}>
                          {plan.cta.button}
                          <div className="bg-background/15 border-background/10 grid size-5.5 place-items-center rounded-full border">
                            <ChevronRight className="size-4 rtl:rotate-180" />
                          </div>
                        </a>
                      )}
                    </Button>
                  </div>

                  {/* Right side - Contact info */}
                  <div className="bg-border flex-1 space-y-4 p-6">
                    <div className="flex justify-between gap-6">
                      <p className="text-card-foreground text-xs leading-none font-semibold">
                        {plan.cta.text}
                      </p>
                      <Logo className="h-5 w-auto gap-1.5 [&_img]:size-4 [&_span]:text-[13px]" />
                    </div>
                    <Button
                      variant="light"
                      className="group h-10 w-full"
                      asChild
                    >
                      <Link href="mailto:alamayo274@gmail.com">
                        דברו איתנו
                        <div className="bg-border border-input grid size-5.5 place-items-center rounded-full border">
                          <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.25" />
                        </div>
                      </Link>
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 p-4 md:grid-cols-2 md:p-6">
                {plan.features.map((feature, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <div className="">
                      {feature.included ? (
                        <div className="border-muted-foreground flex size-4 items-center justify-center rounded-full border-[0.5px]">
                          <Check className="text-muted-foreground size-2" />
                        </div>
                      ) : (
                        <div className="border-muted-foreground flex size-4 items-center justify-center rounded-full border-[0.5px]">
                          <X className="text-muted-foreground/70 size-2" />
                        </div>
                      )}
                    </div>
                    <span
                      className={cn(
                        'text-sm',
                        feature.included
                          ? 'text-muted-foreground'
                          : 'text-muted-foreground/70',
                      )}
                    >
                      {feature.name}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
            )
          })}
        </div>
      </div>
    </section>
  );
}
