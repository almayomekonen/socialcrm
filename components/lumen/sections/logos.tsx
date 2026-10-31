'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

import { Marquee } from '@/components/lumen/magicui/marquee';
import Noise from '@/components/lumen/noise';
import { cn } from '@/components/lumen/utils';

/**
 * Real connections only. Each one is verifiable in the codebase:
 *   WhatsApp / Facebook / Instagram — lib/whatsapp, lib/facebook (Meta Lead Ads)
 *   Google Drive / Calendar        — app/api/auth/google-drive, /google-calendar
 *   Excel                          — lead import + export
 *   OpenAI / Anthropic / Google    — the AI Copilot's providers, lib/ai
 *
 * No logo appears here that the product does not actually talk to.
 */
type Company = {
  name: string
  className: string
  url: string
  logo?: string
  /** Brand name shown beside the mark. */
  label?: string
  /** The brand's own colour for that name — see the notes on each entry. */
  labelColor?: string
}

const companies: Company[] = [
  {
    name: 'WhatsApp',
    label: 'WhatsApp',
    // Official WhatsApp green.
    labelColor: '#25D366',
    logo: '/media/social-icons/whatsapp-color.svg',
    className: '',
    url: 'https://business.whatsapp.com',
  },
  {
    name: 'Facebook',
    label: 'Facebook',
    // Official Facebook blue; its standard lockup sets the wordmark in it.
    labelColor: '#1877F2',
    logo: '/media/social-icons/facebook-color.svg',
    className: '',
    url: 'https://www.facebook.com/business/tools/lead-ads',
  },
  {
    name: 'Instagram',
    label: 'Instagram',
    // The glyph carries the gradient; Instagram's wordmark is monochrome.
    labelColor: '#1A1A1A',
    logo: '/media/social-icons/instagram-color.svg',
    className: '',
    url: 'https://business.instagram.com',
  },
  {
    name: 'אתר',
    label: 'טפסים באתר',
    labelColor: '#5e6ad2',
    logo: '/media/social-icons/website-color.svg',
    className: '',
    url: '/',
  },
  {
    name: 'Google Calendar',
    label: 'Google Calendar',
    // Google sets product names in its neutral grey, not in the mark's colours.
    labelColor: '#5F6368',
    logo: '/media/social-icons/google-calendar-color.svg',
    className: '',
    url: 'https://workspace.google.com/products/calendar/',
  },
  {
    name: 'Google Drive',
    label: 'Google Drive',
    labelColor: '#5F6368',
    logo: '/media/social-icons/google-drive-color.svg',
    className: '',
    url: 'https://workspace.google.com/products/drive/',
  },
];



export default function Logos() {
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Filter out companies with dark:hidden when theme is dark
  // Only apply theme-based filtering after component is mounted to prevent hydration mismatch
  const visibleCompanies = companies.filter((company) => {
    if (
      mounted &&
      theme === 'dark' &&
      company.className.includes('dark:hidden')
    ) {
      return false;
    }
    return true;
  });

  return (
    <section className="section-padding relative">
      <Noise />
      <p className="text-foreground container text-center text-lg font-semibold">
        הלידים שלכם מגיעים מכל מקום: וואטסאפ, פייסבוק ואינסטגרם. SocialCRM מחברת את כולם לרשימה אחת מסודרת.
      </p>

      <div>
        {/*
          `dir="ltr"` on the track. Under RTL the flex row lays the first repeat
          group at the RIGHT edge and stacks the rest off to the left, so the
          right-hand side of the strip was permanently empty — measured: group 1
          at x=468 with groups 2–4 all at negative x. Brand marks carry no
          reading direction, so laying the track out LTR makes it tile and
          travel exactly as it does in Lumen. The section's own text stays RTL.
        */}
        <Marquee
          dir="ltr"
          pauseOnHover
          className="mt-8 mask-r-from-60% mask-r-to-100% mask-l-from-60% mask-l-to-100% [--duration:20s] [--gap:4rem]"
        >
          {visibleCompanies.map((company) => (
            <Link
              key={company.name}
              href={company.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-[40px] items-center gap-2.5 transition-transform duration-200 hover:scale-105"
            >
              {/*
                Marks are 40px, larger than Lumen's 32px slot, so the row is sized to
                the content rather than to Lumen's fixed 96×32 box.

                Mark + wordmark lockup. The glyphs are each brand's own SVG and
                the names use each brand's official colour (WhatsApp #25D366,
                Facebook #1877F2, Instagram's monochrome wordmark, Google's
                neutral #5F6368 for product names).

                The TYPEFACE is ours, not theirs: Facebook Sans, Instagram Sans
                and Google's Product Sans are proprietary and not licensed for
                redistribution, so the names are set in the site font rather
                than faked with a lookalike.
              */}
              <span className="relative block size-[40px] shrink-0">
                <Image
                  src={company.logo!}
                  alt=""
                  aria-hidden="true"
                  fill
                  className={cn('object-contain', company.className)}
                />
              </span>
              <span
                dir={company.name === 'אתר' ? 'rtl' : 'ltr'}
                className="text-base leading-none font-semibold whitespace-nowrap"
                style={{ color: company.labelColor }}
              >
                {company.label}
              </span>
            </Link>
          ))}
        </Marquee>
      </div>
    </section>
  );
}
