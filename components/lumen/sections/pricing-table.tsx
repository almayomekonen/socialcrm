'use client';

import { Check, ChevronsUpDown } from 'lucide-react';
import { useState } from 'react';

import Noise from '@/components/lumen/noise';
import { PRICING } from '@/lib/pricing';
import { TRIAL_LENGTH_DAYS } from '@/lib/trial';
import { Badge } from '@/components/lumen/ui/badge';
import { Button } from '@/components/lumen/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/lumen/ui/collapsible';

interface FeatureSection {
  category: string;
  isNew?: boolean;
  features: {
    name: string;
    isNew?: boolean;
    free: string | boolean | null;
    pro: string | boolean | null;
  }[];
}

const PER_MONTH = `/לחודש`;
const money = (n: number) => `${PRICING.currency}${n}${PER_MONTH}`;

/**
 * The left column is the seven-day trial, not a free plan. An account without a
 * verified card has no product access at all, and inside the trial the lead
 * quota is bypassed — so the two columns are deliberately almost identical.
 * That IS the offer: the trial is Pro, for seven days, for nothing. What
 * differs is how long it lasts and what happens at the end.
 */
const pricingPlans = [
  { name: `${TRIAL_LENGTH_DAYS} ימי ניסיון`, price: money(0) },
  { name: 'Pro', price: money(PRICING.monthly) },
];

/**
 * The same inclusion lists the `/crm` pricing cards render, grouped into
 * categories. Prices come from `lib/pricing` and the lead ceiling from
 * `lib/quota` so the table cannot drift from what the app actually enforces.
 */
const comparisonFeatures: FeatureSection[] = [
  {
    category: 'מחיר',
    features: [
      { name: 'תשלום חודשי', free: money(0), pro: money(PRICING.monthly) },
      { name: 'משך', free: `${TRIAL_LENGTH_DAYS} ימים`, pro: 'חודשי, עד לביטול' },
      { name: 'נדרש כרטיס אשראי', free: true, pro: true },
    ],
  },
  {
    category: 'לידים ומקורות',
    features: [
      { name: 'לידים במערכת', free: 'ללא הגבלה', pro: 'ללא הגבלה' },
      { name: 'חיבור לפייסבוק, אינסטגרם ווואטסאפ', free: true, pro: true },
      { name: 'ייבוא לידים מאקסל', free: true, pro: true },
      { name: 'ייצוא לאקסל ו-PDF', free: true, pro: true },
    ],
  },
  {
    category: 'עבודה יומית',
    features: [
      { name: 'סטטוסים ותאריכי מעקב', free: true, pro: true },
      { name: 'שיחות וואטסאפ מחוברות לליד', free: true, pro: true },
      { name: 'שיוך לידים לנציגים', free: true, pro: true },
      { name: 'חלוקת עמלות על עסקה משותפת', free: true, pro: true },
      { name: 'מחיר אחד לכל סביבת העבודה', free: true, pro: true },
    ],
  },
  {
    category: 'AI',
    features: [
      { name: 'תקציר חכם על כל ליד', free: true, pro: true },
      { name: 'פעולה מומלצת עם הסיבה שלה', free: true, pro: true },
      { name: 'טיוטות להודעות מעקב', free: true, pro: true },
      { name: 'שאלות חופשיות על הליד', free: true, pro: true },
    ],
  },
];

const PricingTable = () => {
  const [selectedPlan, setSelectedPlan] = useState(1);

  return (
    <section className="section-padding">
      <div className="bigger-container space-y-8 lg:space-y-12">
        <Noise />

        <h2 className="text-4xl leading-tight font-semibold tracking-tight lg:text-5xl">
          מה כלול בכל תוכנית
        </h2>
        <div>
          <PlanHeaders
            selectedPlan={selectedPlan}
            onPlanChange={setSelectedPlan}
          />
          <FeatureSections selectedPlan={selectedPlan} />
        </div>
      </div>
    </section>
  );
};

const PlanHeaders = ({
  selectedPlan,
  onPlanChange,
}: {
  selectedPlan: number;
  onPlanChange: (index: number) => void;
  prefersReducedMotion?: boolean;
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="">
      {/* Mobile View */}
      <div className="md:hidden">
        <Collapsible open={isOpen} onOpenChange={setIsOpen} className="">
          <div className="flex items-center justify-between py-4">
            <CollapsibleTrigger className="flex items-center gap-2">
              <h3 className="text-2xl">{pricingPlans[selectedPlan].name}</h3>
              <ChevronsUpDown
                className={`size-5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
              />
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent className="flex flex-col space-y-2 p-2">
            {pricingPlans.map(
              (plan, index) =>
                index !== selectedPlan && (
                  <Button
                    variant="outline"
                    key={index}
                    onClick={() => {
                      onPlanChange(index);
                      setIsOpen(false);
                    }}
                  >
                    {plan.name}
                  </Button>
                ),
            )}
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Desktop View */}
      <div className="grid grid-cols-4 gap-4 max-md:hidden">
        <div className="col-span-1 max-md:hidden md:col-span-2"></div>

        {pricingPlans.map((plan, index) => (
          <h3 key={index} className="mb-3 text-center text-2xl">
            {plan.name}
          </h3>
        ))}
      </div>
    </div>
  );
};

const FeatureSections = ({ selectedPlan }: { selectedPlan: number }) => {
  return (
    <>
      {comparisonFeatures.map((section, sectionIndex) => (
        <div key={sectionIndex} className="flex flex-col md:mt-4 md:gap-1">
          <div className="py-4">
            <h3 className="flex items-center gap-8 text-lg">
              {section.category}
              {section.isNew && <Badge variant="outline">NEW</Badge>}
            </h3>
          </div>
          {section.features.map((feature, featureIndex) => (
            <div
              key={featureIndex}
              className="text-primary grid grid-cols-2 items-center font-semibold md:grid-cols-4"
            >
              <span className="me-8 inline-flex items-center gap-4 py-4 md:col-span-2">
                {feature.name}
                {feature.isNew && (
                  <Badge variant="default" className="rounded-sm">
                    NEW
                  </Badge>
                )}
              </span>
              {/* Mobile View - Only Selected Plan */}
              <div className="md:hidden">
                <div className="bg-border border-input flex items-center justify-center gap-1 rounded-md border py-3 text-sm">
                  {(() => {
                    const value = [feature.free, feature.pro][selectedPlan];
                    return renderFeatureValue(value);
                  })()}
                </div>
              </div>
              {/* Desktop View - All Plans */}
              <div className="hidden md:col-span-2 md:grid md:grid-cols-2 md:gap-1">
                {[feature.free, feature.pro].map((value, i) => (
                  <div
                    key={i}
                    className="bg-border border-input flex items-center justify-center gap-1 rounded-md border py-3 text-sm"
                  >
                    {renderFeatureValue(value)}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </>
  );
};

const renderFeatureValue = (value: string | boolean | null) => {
  if (value === null) {
    return <span className="text-gray-400">-</span>;
  }

  if (typeof value === 'boolean') {
    return value ? (
      <Check className="size-5" />
    ) : (
      <span className="text-gray-400">-</span>
    );
  }

  return <span>{value}</span>;
};

export default PricingTable;
