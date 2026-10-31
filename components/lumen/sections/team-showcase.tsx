'use client';

import Image from 'next/image';
import Link from 'next/link';

import Noise from '@/components/lumen/noise';
import { cn } from '@/components/lumen/utils';

const TECH_STACK = [
  { name: 'פייסבוק', logo: '/media/social-icons/facebook-color.svg', url: '/', className: '' },
  { name: 'אינסטגרם', logo: '/media/social-icons/instagram-color.svg', url: '/', className: '' },
  { name: 'וואטסאפ', logo: '/media/social-icons/whatsapp-color.svg', url: '/', className: '' },
  { name: 'טפסים באתר', logo: '/media/social-icons/website-color.svg', url: '/', className: '' },
];

export default function TeamShowcase() {
  return (
    <section className="section-padding relative">
      <Noise />
      <div className="bigger-container">
        <div className="flex flex-col items-center gap-6 lg:flex-row lg:justify-between lg:gap-12">
          <p className="max-w-sm text-center text-2xl leading-tight lg:text-start">
            הערוצים שמביאים לכם פניות, מחוברים לרשימה אחת שעובדים ממנה.
          </p>

          {/* Right Side - Tech Stack Logos */}
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            {TECH_STACK.map((tech) => (
              <Link
                key={tech.name}
                href={tech.url}
                className="group relative flex h-8 w-32 items-center justify-center transition-opacity duration-200 hover:opacity-80"
              >
                <Image
                  src={tech.logo}
                  alt={tech.name}
                  fill
                  className={cn('object-contain', tech.className)}
                />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
