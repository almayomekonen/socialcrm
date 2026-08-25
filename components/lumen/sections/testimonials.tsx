'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';

import Noise from '@/components/lumen/noise';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from '@/components/lumen/ui/card';
import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/lumen/ui/carousel';
import { cn } from '@/components/lumen/utils';

/**
 * Lumen's accent edge starts at --chart-1, which we rebrand to #5e6ad2 site-wide.
 * Pin this one gradient stop back to the template's own value so the edge is
 * pixel- and colour-identical to the reference.
 */
const LUMEN_EDGE = 'lg:before:from-[oklch(0.585_0.132_257)]';

const COMMON_CARDS_CLASSNAMES = {
  big: 'col-span-4 lg:[&_blockquote]:text-base lg:[&_blockquote]:leading-loose lg:[&_blockquote]:text-foreground',
};
const avatar = (initials: string, color: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="20" fill="${color}"/><text x="20" y="25.5" font-family="system-ui,-apple-system,sans-serif" font-size="15" font-weight="600" fill="#ffffff" text-anchor="middle">${initials}</text></svg>`,
  )}`;

const testimonials = [
  {
    id: '1',
    name: 'רועי כהן',
    title: 'בעל עסק לשיפוצים',
    company: 'רועי כהן',
    image: avatar('רכ', '#3f20f5'),
    companyLogo: {
      src: avatar('רכ', '#3f20f5'),
      width: 24,
      height: 24,
    },
    testimonial:
      'הייתי מנהל לידים במחברת. ברצינות, מחברת. אחרי שפספסתי לקוח שחיכה לי שבועיים החלטתי שמספיק. שבוע במערכת, וכל הצוות סוף סוף ביחד. היום כל פנייה שנכנסת מקבלת שם, סטטוס ותאריך לחזור אליה, ואני כבר לא צריך לזכור כלום בעל פה.',
    className: cn(COMMON_CARDS_CLASSNAMES.big, LUMEN_EDGE),
  },
  {
    id: '2',
    name: 'מיכל לוי',
    title: 'מנהלת מכירות',
    company: '',
    image: avatar('מל', '#7c3aed'),
    testimonial:
      'ניסינו לפני זה שתי מערכות יקרות שאף אחד מהצוות לא הצליח להבין. כאן הנציגים נכנסו ביום הראשון והתחילו לעבוד. זה הכל. בלי הדרכות, בלי מדריך ובלי שאלות. פשוט התחילו למכור. זה חסך לי חודש של הטמעה.',
    className: 'col-span-2 ',
  },
  {
    id: '3',
    name: 'שירה אבגי',
    title: 'יועצת משכנתאות',
    company: '',
    image: avatar('שא', '#0f766e'),
    testimonial:
      'מה שעשה לי את זה זה התזכורות. הייתי שוכחת לחזור ללקוחות אחרי שבוע ומאבדת אותם. עכשיו המערכת מזכירה לי וזהו. לא פספסתי אף אחד מאז. וזה מרגיש אחרת לגמרי.',
    className: 'col-span-2 ',
  },
  {
    id: '4',
    name: 'יוני פרץ',
    title: 'יועץ פיננסי',
    company: '',
    image: avatar('יפ', '#b45309'),
    testimonial:
      'חיפשתי משהו פשוט בעברית, בלי 200 פיצ׳רים שאני לא צריך. זה בדיוק מה שמצאתי. עובד בטלפון גם, וזה חשוב לי כי אני בשטח רוב היום. לא הייתי חוזר לאקסל בחיים.',
    className: 'col-span-2 ',
  },
  {
    id: '5',
    name: 'דרור שמש',
    title: 'בעל סטודיו לכושר',
    company: '',
    image: avatar('דש', '#15803d'),
    testimonial:
      'יש לי שני סוכנים, ולפני המערכת היינו דורסים אחד את השני על אותם לידים. עכשיו כל אחד יודע מה שלו. לא חזרנו ללקוח פעמיים שוב, וזה נראה מקצועי. והלקוחות מרגישים את זה.',
    className: 'col-span-2 ',
  },
  {
    id: '6',
    name: 'אורי מזרחי',
    title: 'בעל מוסך',
    company: '',
    image: avatar('אמ', '#c2410c'),
    testimonial:
      'מישהו כתב לי בשבת בערב ואני בכלל לא הייתי ליד הטלפון. הוא קיבל תשובה, וביום ראשון בבוקר כבר סגרנו. לפני זה הודעה כזאת פשוט הייתה נעלמת לי. היום זה פשוט לא קורה.',
    className: 'col-span-2',
  },
  {
    id: '7',
    name: 'תמר שגב',
    title: 'בעלת קליניקה',
    company: '',
    image: avatar('תש', '#4338ca'),
    testimonial:
      'אני פותחת את המערכת בבוקר עם הקפה ורואה למי לחזור. לפני זה הייתי מתחילה את היום בחיפוש בוואטסאפ. עכשיו אני יודעת מה לעשות עוד לפני שסיימתי את הכוס. וזה משנה לי את כל היום.',
    className: 'col-span-2',
  },
  {
    id: '8',
    name: 'אמיר בן דוד',
    title: 'מנהל קמפיינים',
    company: 'אמיר בן דוד',
    image: avatar('אב', '#0369a1'),
    companyLogo: {
      src: avatar('אב', '#0369a1'),
      width: 28,
      height: 28,
    },
    testimonial:
      'אני מריץ קמפיינים בפייסבוק ובאינסטגרם. עד עכשיו הייתי מוריד אקסל פעמיים ביום ושולח לסוכנים. עכשיו זה פשוט נכנס. כל ליד מגיע עם המקור שלו, אז אני יודע איזו מודעה עבדה ואיזו סתם שרפה תקציב. פעם הייתי מגלה את זה בסוף החודש, כשכבר אין מה לעשות. היום אני רואה תוך כדי ומזיז תקציב באותו יום. וזה לבד החזיר לי את העלות של המערכת בחודש הראשון. אין לי שום סיבה לחזור אחורה. היום אני יודע בדיוק כמה עולה לי ליד מכל מודעה.',
    className: cn(COMMON_CARDS_CLASSNAMES.big, ''),
  },
  {
    id: '9',
    name: 'נטע גולן',
    title: 'מתווכת נדל"ן',
    company: 'נטע גולן',
    image: avatar('נג', '#be185d'),
    companyLogo: {
      src: avatar('נג', '#be185d'),
      width: 20,
      height: 20,
    },
    testimonial:
      'בהתחלה הייתי סקפטית, חשבתי שזה עוד CRM מסובך. אחרי יומיים כבר לא הבנתי איך עבדתי בלי. זה פשוט הפך למקום שאני פותחת ראשון.',
    className: cn(
      COMMON_CARDS_CLASSNAMES.big,
      'lg:[&_blockquote]:text-4xl lg:[&_blockquote]:leading-tight lg:shadow-lg',
      LUMEN_EDGE,
    ),
  },
];

export default function Testimonials() {
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!api) {
      return;
    }

    setCount(api.scrollSnapList().length);
    setCurrent(api.selectedScrollSnap());

    api.on('select', () => {
      setCurrent(api.selectedScrollSnap());
    });
  }, [api]);

  return (
    <section className="section-padding relative overflow-x-hidden">
      <Noise />
      <div className="container">
        {/* Section Header */}
        <div className="mx-auto max-w-4xl space-y-3 lg:space-y-4 lg:text-center">
          <h2 className="text-4xl tracking-tight lg:text-5xl">
            בעלי עסקים שעברו למערכת
          </h2>
          <p className="text-muted-foreground text-lg leading-snug lg:text-balance">
            בעלי עסקים, יועצים, מתווכים ומנהלי קמפיינים שניהלו את הלידים שלהם
            בין אקסלים, הודעות וואטסאפ, שיחות ומחברות ועכשיו מרכזים את כל
            הלידים, השיחות והמעקבים במקום אחד, מסודר וחכם.
          </p>
        </div>

        {/* Desktop Grid */}
        <div className="mx-auto mt-8 hidden max-w-6xl grid-cols-8 gap-2 lg:mt-12 lg:grid">
          {testimonials.map((testimonial) => (
            <TestimonialCard key={testimonial.id} testimonial={testimonial} />
          ))}
        </div>

        {/* Mobile Carousel */}
        {/* Lumen bleeds the carousel past the container on the END side so the
            next card peeks off-screen. Its `-mr-` is physical-right, which is
            the END in LTR but our START in RTL — copied verbatim it cut the
            first card off the right edge and shoved the dots off-centre.
            `-me-` is the logical form: identical in LTR, mirrored here. */}
        <div className="mt-8 -me-[max(2rem,calc((100vw-80rem)/2+5rem))] lg:hidden">
          <Carousel
            /* The page is dir='rtl', but Embla defaults to 'ltr' and the
               shadcn wrapper never forwards a direction. That mismatch made
               scrollTo() compute positions against an LTR axis while the flex
               track laid out RTL, so tapping a dot drove the slides off-screen
               instead of to the matching card. Telling Embla the real
               direction fixes the indexing at its source. */
            opts={{
              align: 'start',
              loop: true,
              direction: 'rtl',
            }}
            className="w-full"
            setApi={setApi}
          >
            <CarouselContent className="-ml-2 lg:-ml-4">
              {testimonials.map((testimonial) => (
                <CarouselItem
                  key={testimonial.id}
                  className="basis-9/10 pl-2 sm:basis-1/2 lg:pl-4"
                >
                  <TestimonialCard testimonial={testimonial} />
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious className="hidden" />
            <CarouselNext className="hidden" />
          </Carousel>

          {/* Carousel Dots */}
          <div className="mt-6 flex justify-center gap-2">
            {Array.from({ length: count }, (_, index) => (
              <button
                key={index}
                onClick={() => api?.scrollTo(index)}
                className={cn(
                  'size-2 rounded-full transition-all duration-200',
                  index === current
                    ? 'bg-foreground scale-110'
                    : 'bg-muted-foreground/30 hover:bg-muted-foreground/50',
                )}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

interface TestimonialCardProps {
  testimonial: {
    id: string;
    name: string;
    title: string;
    company: string;
    image: string;
    companyLogo?: {
      src: string;
      width: number;
      height: number;
    };
    testimonial: string;
    featured?: boolean;
    className?: string;
  };
}

function TestimonialCard({ testimonial }: TestimonialCardProps) {
  const isBigCard = testimonial.className?.includes('col-span-4');
  const withGradientBorder = testimonial.id === '1' || testimonial.id === '9';
  return (
    <Card
      className={cn(
        'hover:shadow-primary/5 relative h-full transition-all duration-300 hover:shadow-lg',
        withGradientBorder &&
          'lg:before:from-chart-1 lg:before:via-chart-2 lg:before:to-chart-3 lg:border-0 lg:before:absolute lg:before:inset-[-1px] lg:before:z-[-1] lg:before:rounded-xl lg:before:bg-gradient-to-tr lg:before:content-[""]',
        testimonial.className,
      )}
    >
      <CardHeader>
        {/* Author Info at Top for Small Cards */}
        {!isBigCard && (
          <div className="flex items-center gap-3">
            <Image
              src={testimonial.image}
              alt={`${testimonial.name} profile`}
              width={40}
              height={40}
              className="rounded-full object-cover"
            />
            <div className="min-w-0 flex-1">
              <div className="text-card-foreground truncate text-sm font-semibold">
                {testimonial.name}
              </div>
              <div className="text-muted-foreground truncate text-xs">
                {testimonial.title}
              </div>
            </div>
          </div>
        )}

        {/* Company Logo for Big Cards Only */}
        {testimonial?.companyLogo?.src && (
          <Image
            src={testimonial.companyLogo.src}
            alt={`${testimonial.company} logo`}
            width={testimonial.companyLogo.width}
            height={testimonial.companyLogo.height}
            className="object-contain dark:invert"
          />
        )}
      </CardHeader>

      <CardContent className="">
        {/* Testimonial Text */}
        <blockquote
          className={cn('lg:text-muted-foreground leading-relaxed lg:text-sm')}
        >
          “{testimonial.testimonial}”
        </blockquote>
      </CardContent>

      {/* Author Info at Bottom for Big Cards */}
      {isBigCard && (
        <CardFooter className="flex items-center gap-3">
          <div className="relative">
            <Image
              src={testimonial.image}
              alt={`${testimonial.name} profile`}
              width={40}
              height={40}
              className="size-10 rounded-full object-cover"
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-card-foreground truncate text-sm font-semibold">
              {testimonial.name}
            </div>
            <div className="text-muted-foreground truncate text-xs">
              {testimonial.title}
            </div>
          </div>
        </CardFooter>
      )}
    </Card>
  );
}
