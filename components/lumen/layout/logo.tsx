import Image from 'next/image';
import Link from 'next/link';
import React from 'react';

import { cn } from '@/components/lumen/utils';
interface LogoProps {
  className?: string;
  wrapperClassName?: string;
  onlyLogo?: boolean;
}

const Logo: React.FC<LogoProps> = ({
  className = '',
  wrapperClassName = '',
  onlyLogo = false,
}) => {
  // Lumen's auth screens use the mark alone at 58x58
  // (`_reference/.../src/components/layout/logo.tsx`, `onlyLogo`). This branch
  // previously still rendered Lumen's own flower SVG — template leftover, and
  // unused anywhere in the app. It now draws the SocialCRM mark at exactly that
  // footprint so `/auth` and `/auth/register` reproduce Lumen's logo placement
  // and sizing with our brand.
  if (onlyLogo) {
    return (
      <Link href="/" className={cn('block', className)} aria-label="SocialCRM">
        <Image
          src="/media/fav.svg"
          alt="SocialCRM"
          width={58}
          height={58}
          priority
          className="size-[58px] object-contain"
        />
      </Link>
    );
  }

  return (
    <div className={cn(``, wrapperClassName)}>
      <Link
        href="/"
        className={cn(`relative flex h-11 flex-row-reverse items-center gap-2`, className)}
      >
        {/*
          `fav.svg` is the SocialCRM mark: a square glyph (viewBox 275×268), not
          a wordmark. Rendering it into Lumen's 100×44 wordmark box would letterbox
          it to a few pixels, so the mark keeps its own square aspect and the
          product name sits beside it as text.
        */}
        <Image
          src="/media/fav.svg"
          alt=""
          aria-hidden="true"
          width={28}
          height={28}
          priority
          className="size-7 shrink-0 object-contain"
        />
        <span className="text-xl font-semibold tracking-tight">SocialCRM</span>
      </Link>
    </div>
  );
};

export default Logo;
