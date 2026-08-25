'use client';

import { Inbox, ListChecks, MessageCircle, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';

import Noise from '@/components/lumen/noise';
import { LeadsWorkspace } from '@/components/marketing/product/LeadsWorkspace';
import { ConversationWorkspace } from '@/components/marketing/product/ConversationWorkspace';
import { PipelineBoard } from '@/components/marketing/product/PipelineBoard';
import { CopilotPanel } from '@/components/marketing/product/CopilotPanel';
import { Card, CardContent } from '@/components/lumen/ui/card';
import usePrefersReducedMotion from '@/hooks/usePrefersReducedMotion';
import { cn } from '@/components/lumen/utils';

/** Feature 2 shows the thread on its own — no lead-context rail. */
const ConversationThread = () => <ConversationWorkspace chatOnly />;

const features = [
  {
    id: 1,
    icon: Inbox,
    title: 'כל הלידים נוחתים ברשימה אחת',
    description:
      'לידים ממודעות פייסבוק ואינסטגרם נכנסים אוטומטית, ושיחות וואטסאפ מתחברות לליד. לכל פנייה יש מקור, סטטוס, נציג ותאריך לחזור אליה.',
    Surface: LeadsWorkspace,
    aspect: '1260 / 669', // features-showcase/1.webp
  },
  {
    id: 2,
    icon: MessageCircle,
    title: 'השיחה והליד הם אותו דבר',
    description:
      'עונים ישירות מהמערכת ורואים מתי ההודעה נמסרה ומתי נקראה. כל הודעה נשמרת על הליד, גם כשנציג מתחלף, ולפנייה חוזרת שולחים תבנית מאושרת.',
    Surface: ConversationThread,
    aspect: '1755 / 892', // features-showcase/2.webp
  },
  {
    id: 3,
    icon: ListChecks,
    title: 'כל ליד יודע איפה הוא עומד',
    description:
      'חדש, בטיפול, מעוניין, סגור — ואבוד כשזה נגמר. אלה הסטטוסים שהמערכת עובדת איתם בפועל, בלי שלבים מומצאים ובלי טבלה שצריך לתחזק ביד.',
    Surface: PipelineBoard,
  },
  {
    id: 4,
    icon: Sparkles,
    title: 'פותחים ליד, וכבר יודעים מה לעשות',
    description:
      'ה-AI קורא את ההיסטוריה של הליד, מסכם איפה זה עומד ומציע את הצעד הבא. הוא לא ממציא נתונים, והודעה נשלחת רק בלחיצה שלך. נפתח בתוכנית Pro.',
    Surface: CopilotPanel,
  },
];


export default function FeaturesShowcase() {
  const prefersReducedMotion = usePrefersReducedMotion();

  // Animation variants
  const featureItem = {
    hidden: {
      opacity: 0,
      y: 30,
      filter: 'blur(2px)',
    },
    visible: {
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
      transition: {
        type: 'spring' as const,
        stiffness: 100,
        damping: 25,
        mass: 1,
        duration: 0.6,
      },
    },
  };

  const contentVariants = {
    hidden: { opacity: 0, x: 0 },
    visible: {
      opacity: 1,
      x: 0,
      transition: {
        type: 'spring' as const,
        stiffness: 120,
        damping: 20,
        delay: 0.1,
      },
    },
  };

  const imageVariants = {
    hidden: {
      opacity: 0,
      scale: 0.95,
      filter: 'blur(1px)',
    },
    visible: {
      opacity: 1,
      scale: 1,
      filter: 'blur(0px)',
      transition: {
        type: 'spring' as const,
        stiffness: 80,
        damping: 20,
        delay: 0.2,
      },
    },
  };

  return (
    <section
      id="features-showcase"
      className="section-padding relative overflow-hidden"
    >
      <Noise />
      <div className="container">
        {/* Section Header */}
        <motion.div
          className="max-w-4xl space-y-6 md:space-y-8"
          initial={prefersReducedMotion ? 'visible' : 'hidden'}
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={{
            hidden: { opacity: 0, y: 30, filter: 'blur(2px)' },
            visible: {
              opacity: 1,
              y: 0,
              filter: 'blur(0px)',
              transition: {
                type: 'spring' as const,
                stiffness: 100,
                damping: 25,
                duration: 0.6,
              },
            },
          }}
        >
          <h2 className="text-4xl tracking-tight lg:text-5xl">
            לא צריך להאמין לנו. תראו איך זה עובד.
          </h2>
          <p className="text-muted-foreground text-lg leading-snug">
            זו המערכת עצמה. הרשימה, השיחות, הסטטוסים וה-AI, כמו שהם נראים
            בעבודה יומיומית.
          </p>
        </motion.div>

        {/* Features */}
        <div className="mt-8 space-y-8 md:mt-14 md:space-y-14 lg:mt-24 lg:space-y-20">
          {features.map((feature, index) => {
            const IconComponent = feature.icon;
            const isReverse = index >= 2;

            return (
              <motion.div
                key={feature.id}
                className={cn(
                  `grid items-center gap-4 lg:grid-cols-2 lg:gap-16`,
                  !isReverse && 'lg:grid-flow-col-dense',
                )}
                variants={featureItem}
                initial={prefersReducedMotion ? 'visible' : 'hidden'}
                whileInView="visible"
                viewport={{ once: true, amount: 0.3 }}
              >
                {/* Content */}
                <motion.div
                  className={cn(
                    `space-y-4 md:space-y-6 lg:space-y-8`,
                    !isReverse && 'lg:col-start-2',
                  )}
                  variants={contentVariants}
                >
                  <div className="flex items-center gap-4">
                    <Card
                      className={cn(
                        `flex size-12 shrink-0 items-center justify-center rounded-sm !p-0 md:size-16`,
                      )}
                    >
                      <IconComponent className="size-6" strokeWidth={2.1} />
                    </Card>
                    <h3 className="text-2xl tracking-tight md:hidden lg:text-3xl">
                      {feature.title}
                    </h3>
                  </div>
                  <div className="space-y-2">
                    <h3 className="hidden text-2xl tracking-tight md:block lg:text-3xl">
                      {feature.title}
                    </h3>
                    <p className="text-muted-foreground/70 text-sm leading-relaxed md:text-base">
                      {feature.description}
                    </p>
                  </div>
                </motion.div>

                {/* Image */}
                <motion.div
                  className={cn('relative', !isReverse && 'lg:col-start-1')}
                  variants={imageVariants}
                >
                  {/* Background circles for first and third images */}
                  {(index === 0 || index === 2) && (
                    <>
                      <div
                        className={cn(
                          'bg-chart-2 absolute size-40 rounded-full opacity-30 blur-3xl will-change-transform md:opacity-80',
                          index === 0 && 'top-0 left-0 -translate-x-1/5',
                          index === 2 && 'top-0 right-0 translate-y-1/2',
                        )}
                      />
                      <div
                        className={cn(
                          'bg-chart-3 absolute size-40 rounded-full opacity-50 blur-3xl will-change-transform md:opacity-100',
                          index === 0 && 'top-0 left-0 translate-y-1/2',
                          index === 2 && 'top-0 right-0 translate-x-1/5',
                        )}
                      />
                    </>
                  )}
                  <Card className="bg-chart-4 relative overflow-hidden !pb-0">
                    <CardContent className="!pe-0">
                      {feature.aspect ? (
                        <div
                          className="overflow-hidden"
                          style={{ aspectRatio: feature.aspect }}
                        >
                          <feature.Surface />
                        </div>
                      ) : (
                        <feature.Surface />
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
