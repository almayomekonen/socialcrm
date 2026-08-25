'use client';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import Noise from '@/components/lumen/noise';

import Logo from './logo';
import { NAV_LINKS } from './navbar';

// Create footer sections from NAV_LINKS and add blog links
const FOOTER_SECTIONS = [
  {
    title: 'המוצר',
    links: [
      { name: 'ניהול לידים', href: '/' },
      { name: 'מחירים', href: '/pricing' },
      { name: 'שאלות נפוצות', href: '/faq' },
    ],
  },
  {
    title: 'ערוצים',
    links: [
      { name: 'פייסבוק', href: '/channels' },
      { name: 'וואטסאפ', href: '/channels' },
      { name: 'אינסטגרם', href: '/channels' },
    ],
  },
  {
    title: 'מידע',
    links: [
      { name: 'תנאי שימוש', href: '/terms' },
      { name: 'מדיניות פרטיות', href: '/privacy' },
      { name: 'מחיקת נתונים', href: '/data-deletion' },
    ],
  },
];


const SOCIAL_LINKS = [
  { name: 'פייסבוק', href: 'https://www.facebook.com/share/1BZNFrLH9R/?mibextid=wwXIfr' },
  { name: 'אינסטגרם', href: 'https://www.instagram.com/socialcrm.ai?igsh=cWVvc2FuMHFtM3R3&utm_source=qr' },
  { name: 'אימייל', href: 'mailto:alamayo274@gmail.com' },
];




const Footer = () => {
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
            {FOOTER_SECTIONS.map((section, index) => (
              <div key={index}>
                <h3 className="text-foreground mb-4 font-bold md:mb-8">
                  {section.title}
                </h3>
                <ul className="space-y-3">
                  {section.links.map((link, linkIndex) => (
                    <li key={linkIndex}>
                      <Link
                        href={link.href}
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
            <Logo className="h-6 gap-2 [&_img]:size-6 [&_span]:text-lg" />
            <div className="mt-4 space-y-3 md:mt-8">
              {SOCIAL_LINKS.map((link, index) => (
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

        <div className="mt-15 flex flex-col items-center justify-between gap-4 md:mt-20 md:flex-row">

          <div className="flex gap-6">
            <Link
              href="/"
              className="text-muted-foreground hover:text-foreground tap-44 text-sm transition-colors"
            >
              © SocialCRM. כל הזכויות שמורות.
            </Link>
            <Link
              href="/privacy"
              className="text-muted-foreground hover:text-foreground tap-44 text-sm transition-colors"
            >מדיניות פרטיות</Link>
            <Link
              href="/terms"
              className="text-muted-foreground hover:text-foreground tap-44 text-sm transition-colors"
            >תנאי שימוש</Link>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
