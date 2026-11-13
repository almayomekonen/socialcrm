import Image from 'next/image';

import Noise from '@/components/lumen/noise';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/lumen/ui/card';

const COLUMNS_DATA = [
  {
    image: '/images/benefits-showcase/1.webp',
    imageAlt: 'לידים מפייסבוק',
    cardTitle: 'פייסבוק',
    cardSubtitle: 'לידים מטפסי Lead Ads',
    cardContent:
      'מחברים את הדף העסקי בכמה לחיצות. מרגע החיבור, כל מי שממלא טופס Lead Ads נכנס למערכת תוך שניות, עם המקור שממנו הגיע.',
    cardPosition: 'bottom' as const,
  },
  {
    image: '/images/benefits-showcase/2.webp',
    imageAlt: 'שיחות וואטסאפ מחוברות לליד',
    cardTitle: 'וואטסאפ',
    name: 'השיחה והליד',
    title: 'הם אותו דבר',
    cardContent:
      'עונים מתוך המערכת ורואים מתי ההודעה נמסרה ומתי נקראה. כל הודעה נשמרת על הליד, גם כשנציג מתחלף, ולפנייה חוזרת שולחים תבנית מאושרת.',
    cardPosition: 'inside' as const,
  },
  {
    image: '/images/benefits-showcase/3.webp',
    imageAlt: 'לידים מאינסטגרם',
    cardTitle: 'אינסטגרם',
    cardSubtitle: 'לידים מקמפיינים',
    cardContent:
      'טפסי לידים ממודעות אינסטגרם נכנסים דרך אותו חיבור ל-Meta. הודעות ישירות באינסטגרם לא נאספות אוטומטית, ואת הליד מוסיפים ידנית.',
    cardPosition: 'top' as const,
  },
];

export default function BenefitsShowcase() {
  return (
    <section className="section-padding relative">
      <Noise />
      <div className="bigger-container">
        <h2 className="mb-12 text-center text-4xl leading-none font-semibold tracking-tight lg:mb-16 lg:text-5xl">
          איך כל ערוץ נכנס למערכת
        </h2>

        {/* Three Column Grid */}
        <div className="mx-auto grid max-w-sm gap-6 lg:mx-0 lg:max-w-none lg:grid-cols-3 lg:gap-8">
          {COLUMNS_DATA.map((column, index) => {
            if (column.cardPosition === 'inside') {
              return <InsideCardColumn key={index} {...column} />;
            }

            return <TopBottomCardColumn key={index} {...column} />;
          })}
        </div>
      </div>
    </section>
  );
}

// Column Components
interface ColumnProps {
  image: string;
  imageAlt: string;
  cardTitle?: string;
  cardSubtitle?: string;
  cardContent: string;
  cardFooter?: string;
  cardPosition: 'top' | 'inside' | 'bottom';
  name?: string;
  title?: string;
}

function TopBottomCardColumn({
  image,
  imageAlt,
  cardTitle,
  cardSubtitle,
  cardContent,
  cardPosition,
}: ColumnProps) {
  return (
    <div className="flex flex-col gap-6">
      {cardPosition === 'bottom' && (
        <div className="relative aspect-[389/384] w-full">
          <Image
            src={image}
            alt={imageAlt}
            fill
            className="rounded-xl border object-cover"
          />
        </div>
      )}
      <Card className="">
        <CardHeader>
          <CardTitle className="text-4xl font-semibold">{cardTitle}</CardTitle>
          <p className="text-base font-semibold">{cardSubtitle}</p>
        </CardHeader>
        <CardContent>
          <CardDescription className="">{cardContent}</CardDescription>
        </CardContent>
      </Card>
      {cardPosition === 'top' && (
        <div className="relative aspect-[389/384] w-full">
          <Image
            src={image}
            alt={imageAlt}
            fill
            className="rounded-xl border object-cover"
          />
        </div>
      )}
    </div>
  );
}

function InsideCardColumn({
  image,
  imageAlt,
  cardTitle,
  name,
  title,
  cardContent,
}: ColumnProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="relative aspect-[326/576] w-full flex-1 overflow-hidden rounded-xl border lg:aspect-auto">
        <Image src={image} alt={imageAlt} fill className="object-cover" />
        {/* Overlay card */}
        <Card className="absolute right-6 bottom-6 left-6 gap-4">
          <CardHeader className="gap-0">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Image
                src="/media/social-icons/whatsapp-color.svg"
                alt=""
                width={24}
                height={24}
                className="size-6"
              />
              {cardTitle}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CardDescription className="">{cardContent}</CardDescription>
          </CardContent>
          <CardFooter className="mt-2 block">
            <span className="font-semibold">{name}</span>{' '}
            <span className="text-sm">{title}</span>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
