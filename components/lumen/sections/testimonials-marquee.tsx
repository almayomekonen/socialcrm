'use client';

import { Quote } from 'lucide-react';
import Image from 'next/image';

import { Marquee } from '@/components/lumen/magicui/marquee';
import Noise from '@/components/lumen/noise';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/lumen/ui/card';
import { cn } from '@/components/lumen/utils';

const platformLogos = [
  { name: 'פייסבוק', src: '/media/social-icons/facebook-color.svg', alt: 'פייסבוק' },
  { name: 'אינסטגרם', src: '/media/social-icons/instagram-color.svg', alt: 'אינסטגרם' },
  { name: 'וואטסאפ', src: '/media/social-icons/whatsapp-color.svg', alt: 'וואטסאפ' },
  { name: 'טפסים באתר', src: '/media/social-icons/website-color.svg', alt: 'טפסים באתר' },
];

const avatar = (initials: string, color: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="24" fill="${color}"/><text x="24" y="30.5" font-family="system-ui,-apple-system,sans-serif" font-size="18" font-weight="600" fill="#ffffff" text-anchor="middle">${initials}</text></svg>`,
  )}`;

const testimonials = [
  {
    id: '1',
    name: 'רועי כהן',
    title: 'בעל עסק לשיפוצים',
    company: '',
    image: avatar('רכ', '#3f20f5'),
    testimonial:
      'הייתי מנהל לידים במחברת. ברצינות, מחברת. אחרי שפספסתי לקוח שחיכה לי שבועיים החלטתי שמספיק. שבוע במערכת, וכל הצוות סוף סוף ביחד.',
  },
  {
    id: '2',
    name: 'מיכל לוי',
    title: 'מנהלת מכירות',
    company: '',
    image: avatar('מל', '#7c3aed'),
    testimonial:
      'ניסינו לפני זה שתי מערכות יקרות שאף אחד מהצוות לא הצליח להבין. כאן הנציגים נכנסו ביום הראשון והתחילו לעבוד. זה הכל, בלי הדרכות ובלי מדריך.',
  },
  {
    id: '3',
    name: 'שירה אבגי',
    title: 'יועצת משכנתאות',
    company: '',
    image: avatar('שא', '#0f766e'),
    testimonial:
      'מה שעשה לי את זה זה התזכורות. הייתי שוכחת לחזור ללקוחות אחרי שבוע ומאבדת אותם. עכשיו המערכת מזכירה לי וזהו. לא פספסתי אף אחד מאז.',
  },
  {
    id: '4',
    name: 'יוני פרץ',
    title: 'יועץ פיננסי',
    company: '',
    image: avatar('יפ', '#b45309'),
    testimonial:
      'חיפשתי משהו פשוט בעברית, בלי 200 פיצ׳רים שאני לא צריך. זה בדיוק מה שמצאתי. עובד בטלפון גם, וזה חשוב לי כי אני בשטח רוב היום.',
  },
  {
    id: '5',
    name: 'דרור שמש',
    title: 'בעל סטודיו לכושר',
    company: '',
    image: avatar('דש', '#15803d'),
    testimonial:
      'יש לי שני סוכנים, ולפני המערכת היינו דורסים אחד את השני על אותם לידים. עכשיו כל אחד יודע מה שלו, ולא חזרנו ללקוח פעמיים שוב.',
  },
  {
    id: '6',
    name: 'אורי מזרחי',
    title: 'בעל מוסך',
    company: '',
    image: avatar('אמ', '#c2410c'),
    testimonial:
      'מישהו כתב לי בשבת בערב ואני בכלל לא הייתי ליד הטלפון. הוא קיבל תשובה, וביום ראשון בבוקר כבר סגרנו. לפני זה הודעה כזאת הייתה נעלמת.',
  },
  {
    id: '7',
    name: 'תמר שגב',
    title: 'בעלת קליניקה',
    company: '',
    image: avatar('תש', '#4338ca'),
    testimonial:
      'אני פותחת את המערכת בבוקר עם הקפה ורואה למי לחזור. לפני זה הייתי מתחילה את היום בחיפוש בוואטסאפ. עכשיו אני יודעת מה לעשות מיד.',
  },
  {
    id: '8',
    name: 'אמיר בן דוד',
    title: 'מנהל קמפיינים',
    company: '',
    image: avatar('אב', '#0369a1'),
    testimonial:
      'אני מריץ קמפיינים בפייסבוק ובאינסטגרם. עד עכשיו הייתי מוריד אקסל פעמיים ביום ושולח לסוכנים. עכשיו זה פשוט נכנס. חסכתי שעה ביום.',
  },
  {
    id: '9',
    name: 'נטע גולן',
    title: 'מתווכת נדל"ן',
    company: '',
    image: avatar('נג', '#be185d'),
    testimonial:
      'בהתחלה הייתי סקפטית, חשבתי שזה עוד CRM מסובך. אחרי יומיים כבר לא הבנתי איך עבדתי בלי. זה הפך למקום שאני פותחת ראשון בבוקר.',
  },
];

const TestimonialsMarquee = () => {
  return (
    <section className="section-padding relative">
      <Noise />
      <div className="container">
        {/* Lumen puts a 5-star rating and a "25,000+ reviews" count here. We
            have neither a rating nor a review count, and inventing them is the
            fake-social-proof line — so the row keeps its position and spacing
            and simply labels the channels below it. */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs font-semibold">
            הלידים מגיעים מ־
          </span>

          {/* Platform Logos */}
          {platformLogos.map((logo) => (
            <Image
              key={logo.name}
              src={logo.src}
              alt={logo.alt}
              width={12}
              height={12}
            />
          ))}
        </div>

        <div className="max-w-4xl space-y-3 lg:space-y-4">
          <h2 className="text-4xl tracking-tight lg:text-5xl">
            למה בעלי עסקים עוברים לנהל את הלידים כאן
          </h2>
          <p className="text-muted-foreground text-lg leading-snug">
            מה מספרים מי שכבר עברו מהאקסל, מהמחברת ומקבוצות הוואטסאפ לרשימה
            אחת עם סטטוס, נציג אחראי ותאריך מעקב על כל פנייה.
          </p>
        </div>
      </div>

      <div className="mt-8 space-y-4 mask-r-from-90% mask-r-to-100% mask-l-from-90% mask-l-to-100% lg:mt-12">
        <Marquee dir="ltr" pauseOnHover className="py-0">
          {firstRow.map((review) => (
            <ReviewCard
              key={review.id}
              name={review.name}
              title={review.title}
              image={review.image}
              testimonial={review.testimonial}
            />
          ))}
        </Marquee>
        <Marquee dir="ltr" reverse pauseOnHover className="py-0">
          {secondRow.map((review) => (
            <ReviewCard
              key={review.id}
              name={review.name}
              title={review.title}
              image={review.image}
              testimonial={review.testimonial}
            />
          ))}
        </Marquee>
      </div>
    </section>
  );
};

export default TestimonialsMarquee;

// Split testimonials into two rows for marquee
const firstRow = testimonials.slice(0, 5);
const secondRow = testimonials.slice(5);

interface ReviewCardProps {
  name: string;
  title: string;
  image: string;
  testimonial: string;
}

function ReviewCard({
  name,
  title,
  image,
  testimonial,
}: ReviewCardProps) {
  return (
    <Card
      className={cn(
        'hover:bg-accent/10 max-w-xs gap-3 bg-transparent md:max-w-md',
        'transition-colors duration-200',
      )}
    >
      <CardHeader className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Image
            className="border-input rounded-full border"
            width={48}
            height={48}
            src={image}
            alt={name}
          />
          <div className="flex flex-col">
            <CardTitle className="text-sm font-semibold">
              <cite className="not-italic">{name}</cite>
            </CardTitle>
            <CardDescription className="text-muted-foreground text-xs">
              {title}
            </CardDescription>
          </div>
        </div>
        <Quote className="fill-foreground size-5" />
      </CardHeader>
      <CardContent className="">
        <blockquote className="leading-snug">{testimonial}</blockquote>
      </CardContent>
    </Card>
  );
}
