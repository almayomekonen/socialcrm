'use client';

import { ChevronRightIcon, MessageSquare } from 'lucide-react';
import Link from 'next/link';

import Noise from '@/components/lumen/noise';
import { HE } from '@/lib/marketing/copy/he';
import type { FaqSectionCopy } from '@/lib/marketing/copy/types';
import { TRIAL_LENGTH_DAYS } from '@/lib/trial';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/lumen/ui/accordion';
import { Button } from '@/components/lumen/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from '@/components/lumen/ui/card';



/**
 * `headingLevel` mirrors `Pricing`: `/faq` owns the page <h1>, the homepage
 * keeps <h2>. Tag only — classes and copy are untouched.
 */
export default function FAQSection({
  headingLevel = 'h2',
  copy = HE.faq,
  sectionId,
}: { headingLevel?: 'h1' | 'h2'; copy?: FaqSectionCopy; sectionId?: string } = {}) {
  const Heading = headingLevel
  return (
    <section id={sectionId} className="section-padding relative">
      <Noise />
      <div className="container">
        {/* Section Header */}
        <Heading className="text-4xl leading-tight tracking-tight lg:text-5xl">
          {copy.title}
        </Heading>

        {/* FAQ Content */}
        <div className="mt-8 grid gap-6 lg:mt-12 lg:grid-cols-3">
          {/* FAQ Accordion - Left Side */}
          <div className="lg:col-span-2">
            <Accordion type="single" collapsible className="space-y-4">
              {copy.items.map((faq) => (
                <AccordionItem
                  key={faq.id}
                  value={faq.id}
                  className="border-input hover:shadow-primary/5 rounded-lg !border px-6 py-2 transition-all duration-300 hover:shadow-md"
                >
                  <AccordionTrigger className="min-w-0 cursor-pointer text-start text-base font-semibold text-balance hover:no-underline md:text-lg lg:text-xl [&>span]:min-w-0">
                    {faq.question}
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground pb-6 text-base leading-relaxed">
                    {faq.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>

          <Card className="hover:shadow-primary/5 h-full gap-6 transition-all duration-300 hover:shadow-lg">
            <CardHeader className="gap-6 md:gap-8 lg:gap-11">
              <MessageSquare className="text-secondary size-18 stroke-1 md:size-20" />

              <h3 className="text-2xl">{copy.cardTitle}</h3>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-muted-foreground">
                {copy.cardBodyBeforeDays}{TRIAL_LENGTH_DAYS}{copy.cardBodyAfterDays}
              </p>
            </CardContent>
            <CardFooter className="mt-auto justify-self-end !px-4 sm:!px-6">
              <Button
                size="lg"
                variant="light"
                className="group h-12 w-full min-w-0 gap-3 px-4"
                asChild
              >
                <Link href={copy.cardCtaHref}>
                  {copy.cardCta}
                  <div className="bg-border border-input grid size-5.5 place-items-center rounded-full border">
                    <ChevronRightIcon className="size-4 transition-transform group-hover:translate-x-0.25 rtl:rotate-180" />
                  </div>
                </Link>
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </section>
  );
}
