'use client';

import { CalendarClock, Inbox, MessageCircle, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';

import Noise from '@/components/lumen/noise';
import { UnifiedInflow } from '@/components/marketing/product/ChannelInflow';
import { FollowUpQueue } from '@/components/marketing/product/FollowUpQueue';
import { ConversationWorkspace } from '@/components/marketing/product/ConversationWorkspace';
import { CopilotPanel } from '@/components/marketing/product/CopilotPanel';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/lumen/ui/card';
import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem,
} from '@/components/lumen/ui/carousel';
import usePrefersReducedMotion from '@/hooks/usePrefersReducedMotion';
import { cn } from '@/components/lumen/utils';

const features = [
  {
    id: 1,
    icon: Inbox,
    title: 'כל הלידים נוחתים ברשימה אחת',
    description: 'פייסבוק, אינסטגרם ווואטסאפ נכנסים יחד, כל אחד עם מקור וסטטוס.',
    Surface: UnifiedInflow,
  },
  {
    id: 2,
    icon: MessageCircle,
    title: 'השיחה והליד הם אותו דבר',
    description: 'עונים מהמערכת ורואים מתי ההודעה נמסרה ומתי היא נקראה.',
    Surface: ConversationWorkspace,
  },
  {
    id: 3,
    icon: CalendarClock,
    title: 'שום מעקב לא נופל בין הכיסאות',
    description: 'ליד שממתין מעל 24 שעות חוזר מעצמו לרשימה של היום.',
    Surface: FollowUpQueue,
  },
  {
    id: 4,
    icon: Sparkles,
    title: 'AI שמכיר את כל ההיסטוריה',
    description: 'תקציר קצר, שתי נקודות מפתח והצעד הבא המומלץ על כל ליד.',
    Surface: CopilotPanel,
  },
];


export default function FeaturesCarousel() {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [api, setApi] = useState<CarouselApi>();
  const [activeIndex, setActiveIndex] = useState(0);

  // Animation variants
  const headerVariants = {
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
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.2,
      },
    },
  };

  const buttonVariants = {
    hidden: { opacity: 0, scale: 0.8, filter: 'blur(2px)' },
    visible: {
      opacity: 1,
      scale: 1,
      filter: 'blur(0px)',
      transition: {
        type: 'spring' as const,
        stiffness: 120,
        damping: 20,
      },
    },
  };

  const cardVariants = {
    hidden: {
      opacity: 0,
      x: 60,
      scale: 0.95,
      filter: 'blur(3px)',
    },
    visible: {
      opacity: 1,
      x: 0,
      scale: 1,
      filter: 'blur(0px)',
      transition: {
        type: 'spring' as const,
        stiffness: 80,
        damping: 20,
        duration: 0.8,
      },
    },
  };

  const handleFeatureClick = (index: number) => {
    setActiveIndex(index);
    api?.scrollTo(index);
  };

  // Listen to carousel changes to update active index
  useEffect(() => {
    if (!api) return;

    const onSelect = () => {
      setActiveIndex(api.selectedScrollSnap());
    };

    api.on('select', onSelect);
    onSelect(); // Set initial state

    return () => {
      api.off('select', onSelect);
    };
  }, [api]);

  return (
    <section
      id="features-carousel"
      className="section-padding relative overflow-x-hidden"
    >
      <Noise />
      <div className="container grid gap-8 lg:grid-cols-3 lg:gap-40">
        {/* Left Content */}
        <div className="flex flex-col gap-8 lg:col-span-1">
          {/* Title and Description */}
          <motion.div
            className="space-y-4"
            initial={prefersReducedMotion ? 'visible' : 'hidden'}
            whileInView="visible"
            viewport={{ once: true, amount: 0.3 }}
            variants={headerVariants}
          >
            <h2 className="text-4xl tracking-tight text-balance lg:text-5xl">
              מהרגע שהליד נכנס{' '}
              <span className="text-muted-foreground/80">
                ועד שהוא נסגר
              </span>
            </h2>
            <p className="text-muted-foreground text-lg leading-snug">
              ארבעה דברים שקורים על כל ליד, בלי שתצטרך לזכור אותם.
            </p>
          </motion.div>

          {/* Icon Buttons */}
          <motion.div
            className="mx-auto hidden max-w-[155px] grid-cols-2 justify-between gap-5 lg:grid"
            initial={prefersReducedMotion ? 'visible' : 'hidden'}
            whileInView="visible"
            viewport={{ once: true, amount: 0.3 }}
            variants={containerVariants}
          >
            {features.map((feature, index) => {
              const IconComponent = feature.icon;
              const isActive = index === activeIndex;

              return (
                <motion.button
                  key={feature.id}
                  onClick={() => handleFeatureClick(index)}
                  variants={buttonVariants}
                  className={cn(
                    `border-input hover:bg-border/50 flex h-16 w-16 cursor-pointer items-center justify-center rounded-sm border transition-all duration-300`,
                    isActive && 'bg-border',
                  )}
                >
                  <IconComponent className="size-5" strokeWidth={2.1} />
                </motion.button>
              );
            })}
          </motion.div>

          {/* Dots Indicator */}
          <div className="mt-6 hidden flex-1 items-end justify-center gap-1 lg:flex">
            {features.map((_, index) => (
              <button
                key={index}
                onClick={() => handleFeatureClick(index)}
                className={cn(
                  'relative size-1.5 cursor-pointer rounded-full transition-all duration-300',
                  "before:absolute before:-inset-2.5 before:content-['']",
                  index === activeIndex
                    ? 'bg-foreground'
                    : 'bg-muted-foreground/30 hover:bg-muted-foreground/50',
                )}
                aria-label={`Go to slide ${index + 1}`}
              />
            ))}
          </div>
        </div>

        {/* Right Content - Carousel Cards */}
        <motion.div
          className="select-none md:mask-r-from-60% md:mask-r-to-100% lg:col-span-2"
          initial={prefersReducedMotion ? 'visible' : 'hidden'}
          whileInView="visible"
          viewport={{ once: true, amount: 0.2 }}
          variants={cardVariants}
        >
          <Carousel
            setApi={setApi}
            opts={{
              align: 'start',
              skipSnaps: false,
              direction: 'rtl',
            }}
            className="cursor-grab"
          >
            <CarouselContent className="h-full">
              {features.map((feature) => (
                <CarouselItem
                  key={feature.id}
                  className="h-full md:basis-[60%]"
                >
                  <Card className="bg-border border-input aspect-[284/362] h-full !pb-0 transition-all duration-300 hover:shadow-lg lg:aspect-[384/562]">
                    <CardHeader>
                      <CardTitle className="text-lg leading-tight md:text-2xl lg:text-3xl">
                        {feature.title}
                      </CardTitle>
                      <CardDescription className="text-sm md:text-lg">
                        {feature.description}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="relative h-full">
                      <div className="bg-card dark:bg-card-foreground border-input relative h-full overflow-hidden rounded-lg border">
                        {/*
                          Lumen puts an <Image fill className="object-contain
                          transition-transform hover:scale-105"> here — absolutely
                          positioned, filling the box, scaling on hover. A plain
                          component sits in normal flow instead, so the card read
                          differently. This wrapper reproduces the image's box
                          behaviour exactly; only the pixels inside it differ.
                        */}
                        <div className="absolute inset-0 overflow-hidden transition-transform duration-300 hover:scale-105 [&>*]:h-full">
                          <feature.Surface />
                        </div>
                      </div>
                      <div className="to-chart-4 absolute inset-0 bg-gradient-to-b from-transparent from-70%"></div>
                    </CardContent>
                  </Card>
                </CarouselItem>
              ))}
            </CarouselContent>
          </Carousel>
          {/* Icon Buttons */}
          <motion.div
            className="mx-auto my-8 flex max-w-md justify-between gap-4 lg:hidden"
            initial={prefersReducedMotion ? 'visible' : 'hidden'}
            whileInView="visible"
            viewport={{ once: true, amount: 0.3 }}
            variants={containerVariants}
          >
            {features.map((feature, index) => {
              const IconComponent = feature.icon;
              const isActive = index === activeIndex;

              return (
                <motion.button
                  key={feature.id}
                  onClick={() => handleFeatureClick(index)}
                  variants={buttonVariants}
                  className={cn(
                    `border-input hover:bg-border/50 flex h-16 w-16 cursor-pointer items-center justify-center rounded-sm border transition-all duration-300`,
                    isActive && 'bg-border',
                  )}
                >
                  <IconComponent className="size-5" strokeWidth={2.1} />
                </motion.button>
              );
            })}
          </motion.div>

          {/* Dots Indicator */}
          <motion.div
            className="flex flex-1 items-end justify-center gap-1 lg:hidden"
            initial={prefersReducedMotion ? 'visible' : 'hidden'}
            whileInView="visible"
            viewport={{ once: true, amount: 0.3 }}
            variants={containerVariants}
          >
            {features.map((_, index) => (
              <motion.button
                key={index}
                onClick={() => handleFeatureClick(index)}
                variants={buttonVariants}
                className={cn(
                  'relative size-1.5 cursor-pointer rounded-full transition-all duration-300',
                  "before:absolute before:-inset-2.5 before:content-['']",
                  index === activeIndex
                    ? 'bg-foreground'
                    : 'bg-muted-foreground/30 hover:bg-muted-foreground/50',
                )}
                aria-label={`Go to slide ${index + 1}`}
              />
            ))}
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
