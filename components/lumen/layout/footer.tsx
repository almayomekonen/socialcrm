'use client';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import Noise from '@/components/lumen/noise';

import Logo from './logo';
import { NAV_LINKS } from './navbar';
import { BUSINESS_ADDRESS, BUSINESS_PHONE_DISPLAY, BUSINESS_PHONE_HREF } from '@/lib/businessContact';
import { HE } from '@/lib/marketing/copy/he';
import type { FooterCopy } from '@/lib/marketing/copy/types';

const socialLinksFrom = (copy: FooterCopy) => [
  { name: copy.social.facebook, href: 'https://www.facebook.com/share/1BZNFrLH9R/?mibextid=wwXIfr' },
  { name: copy.social.instagram, href: 'https://www.instagram.com/socialcrm.ai?igsh=cWVvc2FuMHFtM3R3&utm_source=qr' },
  { name: copy.social.email, href: 'mailto:alamayo274@gmail.com' },
];




const Footer = ({ copy = HE.footer }: { copy?: FooterCopy } = {}) => {
  const pathname = usePathname();

  const hideFooter = [
    '/signin',
    '/signup',
    '/docs',
    '/not-found',
    '/forgot-password',
  ].some((route) => pathname.includes(route));

  if (hideFooter) return null;

  return (
    <footer className="relative border-t py-12">
      <Noise />

      <div className="container">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {/* Left side - Footer sections */}
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-3 md:col-span-3">
            {copy.sections.map((section, index) => (
              <div key={index}>
                <h3 className="text-foreground mb-4 font-bold md:mb-8">
                  {section.title}
                </h3>
                <ul className="space-y-3">
                  {section.links.map((link, linkIndex) => (
                    <li key={linkIndex}>
                      <Link
                        href={link.href}
                        hrefLang={link.hrefLang}
                        className="text-muted-foreground hover:text-foreground tap-44 text-sm transition-colors"
                      >
                        {link.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Right side - Lumen branding and social */}
          <div className="flex w-fit flex-col items-start justify-self-end md:col-span-1">
            <Logo href={copy.logoHref} markFirst={copy.dir === 'ltr'} className="h-6 gap-2 [&_img]:size-6 [&_span]:text-lg" />
            <div className="mt-4 space-y-3 md:mt-8">
              {socialLinksFrom(copy).map((link, index) => (
                <Link
                  key={index}
                  href={link.href}
                  className="text-muted-foreground hover:text-foreground tap-44 flex items-center gap-2 text-sm transition-colors"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {link.name}
                </Link>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-15 flex flex-col items-center justify-between gap-6 md:mt-20 md:flex-row">

          {/*
            Contact details, required by Grow's site-approval checklist: a phone
            shown clearly on the home page, and the business address on the site
            or in the תקנון. Both appear on every page this footer serves.

            The number is forced dir="ltr" — in an RTL paragraph a bare
            "053-531-7356" has its segments reordered by the bidi algorithm and
            a customer would read a different number than the one we dial.
          */}
          <div className="text-muted-foreground flex flex-col items-center gap-1 text-sm md:items-start">
            <a
              href={BUSINESS_PHONE_HREF}
              className="hover:text-foreground tap-44 transition-colors"
            >
              {copy.phoneLabel}{' '}
              <span dir="ltr" className="inline-block">
                {BUSINESS_PHONE_DISPLAY}
              </span>
            </a>
            <address className="not-italic" {...copy.addressLang}>{BUSINESS_ADDRESS}</address>
          </div>

          <div className="flex flex-wrap justify-center gap-6">
            <Link
              href={copy.copyrightHref}
              className="text-muted-foreground hover:text-foreground tap-44 text-sm transition-colors"
            >
              {copy.copyright}
            </Link>
            <Link
              href="/privacy"
              hrefLang={copy.legalHrefLang}
              className="text-muted-foreground hover:text-foreground tap-44 text-sm transition-colors"
            >{copy.privacy}</Link>
            <Link
              href="/terms"
              hrefLang={copy.legalHrefLang}
              className="text-muted-foreground hover:text-foreground tap-44 text-sm transition-colors"
            >{copy.terms}</Link>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
