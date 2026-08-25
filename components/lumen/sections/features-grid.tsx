'use client';

import Image from 'next/image';

import Noise from '@/components/lumen/noise';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/lumen/ui/card';
import { cn } from '@/components/lumen/utils';

const FEATURES_DATA = [
  {
    id: 1,
    image: '/media/product/whatsapp-auto-response.png',
    imageAlt: 'הגדרות המענה האוטומטי בוואטסאפ במערכת SocialCRM',
    title: 'מענה אוטומטי בוואטסאפ',
    description:
      'ליד שכותב בוואטסאפ מקבל תשובה תוך שניות, גם כשאתם לא ליד המסך, ואתם ממשיכים את השיחה מתוך המערכת.',
    className: 'lg:col-span-3',
    width: 1128,
    height: 608,
  },
  {
    id: 2,
    image: '/media/product/whatsapp-templates.png',
    imageAlt: 'רשימת הודעות WhatsApp המוכנות לשליחה במערכת SocialCRM',
    title: 'הודעות WhatsApp מוכנות',
    description:
      'הודעות מאושרות מראש שמוכנות לשליחה, עם שם הליד והפרטים שלו שמוזנים אוטומטית בזמן השליחה.',
    className: 'lg:col-span-3',
    width: 992,
    height: 520,
  },
  {
    id: 3,
    image: '/media/product/meetings-week.png',
    imageAlt: 'יומן הפגישות של SocialCRM בתצוגה שבועית',
    title: 'יומן פגישות מובנה',
    description:
      'כל פגישה שקבעתם עם ליד יושבת ביומן אחד, בתצוגת יום, שבוע או חודש, ומסתנכרנת אוטומטית ליומן Google שלכם.',
    className: 'lg:col-span-4',
    width: 1362,
    height: 510,
  },
  {
    id: 4,
    image: '/media/product/deal-comparison.png',
    imageAlt: 'השוואת עסקאות לפי קטגוריה במערכת SocialCRM',
    title: 'השוואת עסקאות',
    description:
      'רואים איך העסקאות מתחלקות בין שירותים, מוצרים, קורסים ומנויים, וכמה עמלה נכנסה מכל קטגוריה בעסק.',
    className: 'lg:col-span-2',
    width: 755,
    height: 556,
  },
  {
    id: 5,
    image: '/media/product/business-identity.png',
    imageAlt: 'פרטי העסק של SocialCRM מופיעים בכל הערוצים והמסמכים',
    title: 'כל העסק שלך במקום אחד',
    description:
      'פרטי העסק שלך נשמרים פעם אחת ומופיעים בוואטסאפ, בחשבוניות, בתשלומים ובמיילים ללקוחות.',
    className: 'lg:col-span-3',
    width: 1554,
    height: 652,
  },
  {
    id: 6,
    image: '/media/product/automation-sequence.png',
    imageAlt: 'רצף מעקב אוטומטי אחרי ליד במערכת SocialCRM',
    title: 'אוטומציות מעקב',
    description:
      'רצף מעקב אוטומטי לליד: מיד, אחרי יומיים ואחרי שבוע, עד שהוא חוזר אליכם.',
    className: 'lg:col-span-3',
    width: 978,
    height: 350,
  },
];

export default function FeaturesGrid() {
  return (
    <section id="features-grid" className="section-padding relative">
      <Noise />
      <div className="container">
        {/* Section Header */}
        <div className="mx-auto max-w-5xl space-y-3 lg:space-y-4 lg:text-center">
          <h2 className="text-4xl tracking-tight lg:text-5xl">
            מערכת ניהול לידים שמתאימה לאיך שאתה באמת עובד
          </h2>
          <p className="text-muted-foreground text-lg leading-snug lg:text-balance">
            משייכים נציג, מעדכנים סטטוס ועוקבים אחרי כל פנייה בדיוק.
            SocialCRM מכניסה סדר לתהליך המכירה שלך ועוזרת לענות מהר
            יותר, בלי טפסים מיותרים, בלי הגדרות מסובכות ובלי להאט אותך.
          </p>
        </div>

        {/* Features Grid */}
        <div className="mt-8 grid grid-cols-1 gap-2 lg:mt-12 lg:grid-cols-6">
          {FEATURES_DATA.map((feature) => (
            <FeatureCard key={feature.id} {...feature} />
          ))}
        </div>
      </div>
    </section>
  );
}

interface FeatureCardProps {
  image: string;
  imageAlt: string;
  title: string;
  description: string;
  className?: string;
  width: number;
  height: number;
}

function FeatureCard({
  image,
  imageAlt,
  title,
  description,
  className,
  width,
  height,
}: FeatureCardProps) {
  return (
    <Card className={cn('h-full', className)}>
      {/* Image Section */}
      <CardContent>
        <div className="overflow-hidden rounded-lg">
          <Image
            src={image}
            alt={imageAlt}
            width={width}
            height={height}
            className="w-full object-cover"
          />
        </div>
      </CardContent>

      {/* Content Section */}
      <CardHeader>
        <CardTitle className="text-xl leading-tight font-semibold">
          {title}
        </CardTitle>
        <p className="text-muted-foreground/70 leading-relaxed">
          {description}
        </p>
      </CardHeader>
    </Card>
  );
}
