'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { motion } from 'motion/react';
import Image from 'next/image';

import Noise from '@/components/lumen/noise';
import { Button } from '@/components/lumen/ui/button';
import usePrefersReducedMotion from '@/hooks/usePrefersReducedMotion';

export default function Hero() {
  const prefersReducedMotion = usePrefersReducedMotion();

  // Animation variants
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.2,
        delayChildren: 0.3,
      },
    },
  };

  const itemVariants = {
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

  const overlayVariants = {
    hidden: {
      opacity: 0,
      y: -50,
    },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        type: 'spring' as const,
        stiffness: 120,
        damping: 20,
        duration: 0.8,
      },
    },
  };

  const imageVariants = {
    hidden: {
      opacity: 0,
      y: 40,
      scale: 0.95,
      filter: 'blur(3px)',
    },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      filter: 'blur(0px)',
      transition: {
        type: 'spring' as const,
        stiffness: 80,
        damping: 20,
        delay: 0.4,
        duration: 0.8,
      },
    },
  };

  return (
    <section className="section-padding relative flex flex-col items-center bg-[url(/images/gradient.webp)] bg-cover bg-center bg-no-repeat !pb-0 dark:bg-[url(/images/gradient-dark.webp)]">
      <motion.div
        variants={overlayVariants}
        initial={prefersReducedMotion ? 'visible' : 'hidden'}
        animate="visible"
        className="from-background/30 pointer-events-none absolute inset-0 bg-gradient-to-b to-transparent"
      />
      <Noise />
      <motion.div
        className="z-1 container text-center"
        variants={containerVariants}
        initial={prefersReducedMotion ? 'visible' : 'hidden'}
        animate="visible"
      >
        <motion.h1
          variants={itemVariants}
          className="text-3xl leading-tight font-bold tracking-tight md:text-5xl lg:text-6xl"
        >
          כל הלידים שלך במקום אחד
          <br className="hidden md:block" /> בלי לפספס שום פנייה בדרך
        </motion.h1>

        <motion.p
          variants={itemVariants}
          /* `text-balance` is the one adaptation the Hebrew copy needs to land
             Lumen's composition. Lumen's English subtitle rags 87%/68% of the
             text column — a wide line over a slightly shorter one. Ours broke
             naturally at 91%/43%, leaving a stub second line that reads as a
             widow, and that is what made the mobile hero feel unlike the
             reference. Balancing gives 68%/65%: the same tidy two-line block at
             the same 40px height, with no change to copy, type scale, spacing
             or desktop (where the line is single and balance is a no-op). */
          className="text-muted-foreground my-2 text-sm text-balance md:my-4 md:text-lg lg:my-6 lg:text-xl"
        >
          אתם כבר לא צריכים לזכור מי מחכה לתשובה. פותחים בבוקר ורואים בדיוק
          למי לחזור היום.
        </motion.p>

        <motion.div variants={itemVariants}>
          <Button
            asChild
            size="lg"
            className="mt-2 rounded-full !ps-5.5 before:rounded-full"
          >
            <Link href="/auth">
            התחל בחינם
            <div className="bg-background/15 border-background/10 grid size-5.5 place-items-center rounded-full border">
              <ChevronRight className="size-4 rtl:rotate-180" />
            </div>
            </Link>
          </Button>
        </motion.div>

        <motion.div
          variants={imageVariants}
          className="bg-background/45 border-background relative mt-10 justify-self-end overflow-hidden rounded-t-xl border p-2 md:mt-20 md:rounded-t-3xl md:p-4 lg:mt-25"
        >
          {/* SocialCRM product shot. Intrinsic 2560×1116 (2.29:1) — Lumen's own
              was 1056×752.5 (1.4:1), so the frame sits much shorter. Frame,
              radii, padding, entrance variant and `priority` are unchanged. */}
          <Image
            src="/media/social-icons/hero.png"
            alt="ממשק SocialCRM"
            width={2560}
            height={1116}
            priority
            className="border-background/45 rounded-t-sm md:rounded-t-xl"
          />
        </motion.div>
        {/* Bottom scrim, softened from Lumen's opaque `from-background` to /55.
            Lumen's own hero image fades into abstract UI at its lower edge, so a
            full-strength wash costs nothing there; ours is a real screenshot whose
            bottom rows are still legible content. */}
        {/* Bottom-only fade. Lumen spans this scrim across `inset-0` and relies on
            a `via-25%` stop to keep the middle clear, which still tints the whole
            frame. Anchoring it to a band at the bottom edge instead hides only the
            image's lower rows and leaves everything above at full strength. */}
        <div className="from-background pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t to-transparent md:h-56" />
      </motion.div>
    </section>
  );
}
