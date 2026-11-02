'use client';

import Image from 'next/image';

import Noise from '@/components/lumen/noise';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/lumen/ui/card';
import { cn } from '@/components/lumen/utils';
import { HE } from '@/lib/marketing/copy/he';
import type { FeaturesGridCopy } from '@/lib/marketing/copy/types';

const FEATURE_VISUALS = [
  { id: 1, image: '/media/product/whatsapp-auto-response.png', className: 'lg:col-span-3', width: 1128, height: 608 },
  { id: 2, image: '/media/product/whatsapp-templates.png', className: 'lg:col-span-3', width: 992, height: 520 },
  { id: 3, image: '/media/product/meetings-week.png', className: 'lg:col-span-4', width: 1362, height: 510 },
  { id: 4, image: '/media/product/deal-comparison.png', className: 'lg:col-span-2', width: 755, height: 556 },
  { id: 5, image: '/media/product/business-identity.png', className: 'lg:col-span-3', width: 1554, height: 652 },
  { id: 6, image: '/media/product/automation-sequence.png', className: 'lg:col-span-3', width: 978, height: 350 },
];

export default function FeaturesGrid({ copy = HE.featuresGrid }: { copy?: FeaturesGridCopy } = {}) {
  return (
    <section id="features-grid" className="section-padding relative">
      <Noise />
      <div className="container">
        {/* Section Header */}
        <div className="mx-auto max-w-5xl space-y-3 lg:space-y-4 lg:text-center">
          <h2 className="text-4xl tracking-tight lg:text-5xl">
            {copy.title}
          </h2>
          <p className="text-muted-foreground text-lg leading-snug lg:text-balance">
            {copy.subtitle}
          </p>
        </div>

        {/* Features Grid */}
        <div className="mt-8 grid grid-cols-1 gap-2 lg:mt-12 lg:grid-cols-6">
          {FEATURE_VISUALS.map((visual, index) => (
            <FeatureCard key={visual.id} {...visual} {...copy.items[index]} />
          ))}
        </div>
      </div>
    </section>
  );
}

interface FeatureCardProps {
  image: string;
  imageAlt: string;
  title: string;
  description: string;
  className?: string;
  width: number;
  height: number;
}

function FeatureCard({
  image,
  imageAlt,
  title,
  description,
  className,
  width,
  height,
}: FeatureCardProps) {
  return (
    <Card className={cn('h-full', className)}>
      {/* Image Section */}
      <CardContent>
        <div className="overflow-hidden rounded-lg">
          <Image
            src={image}
            alt={imageAlt}
            width={width}
            height={height}
            className="w-full object-cover"
          />
        </div>
      </CardContent>

      {/* Content Section */}
      <CardHeader>
        <CardTitle className="text-xl leading-tight font-semibold">
          {title}
        </CardTitle>
        <p className="text-muted-foreground/70 leading-relaxed">
          {description}
        </p>
      </CardHeader>
    </Card>
  );
}
