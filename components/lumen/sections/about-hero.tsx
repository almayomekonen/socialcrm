import Image from 'next/image';

import Noise from '@/components/lumen/noise';

// Facts from the product, not audience statistics: channel count, the status
// vocabulary in lib/leads/statusStyles, the 7-day trial in db/trial, the free
// ceiling in lib/quota and the price in lib/pricing.
const stats = [
  { number: '3', label: 'ערוצים מחוברים למערכת אחת' },
  { number: '1', label: 'רשימה אחת לכל הפניות' },
  { number: '5', label: 'סטטוסים לאורך המכירה' },
  { number: '7', label: 'ימי התנסות במערכת המלאה' },
  { number: '50', label: 'לידים בתוכנית החינמית' },
  { number: '0', label: 'כרטיס אשראי כדי להתחיל' },
];

export default function AboutHero() {
  return (
    <section className="section-padding relative">
      <Noise />
      <div className="bigger-container">
        {/* Hero Content */}
        <div className="text-center">
          <h1 className="text-center text-4xl font-semibold tracking-tighter md:text-6xl md:leading-none lg:text-7xl">
            כל הערוצים במקום אחד
          </h1>
          <p className="text-muted-foreground mx-auto mt-3 hidden max-w-3xl text-lg leading-relaxed md:block lg:mt-4">
            פייסבוק, אינסטגרם ווואטסאפ הם המקומות שבהם הפניות שלכם נמצאות.
            SocialCRM מחברת את שלושתם לרשימה אחת, ומוסיפה לכל פנייה שיחה,
            סטטוס, נציג ותאריך לחזור אליה.
          </p>
        </div>

        {/* Hero Images */}
        <div className="mt-8 grid gap-6 sm:grid-cols-12 lg:mt-12">
          {/* First image - widest (spans 6 columns on desktop) */}
          <div className="relative h-60 overflow-hidden rounded-xl border sm:col-span-5 md:h-80">
            <Image
              src="https://images.unsplash.com/photo-1587825140708-dfaf72ae4b04?w=1200&h=1600&fit=crop"
              alt="ניהול לידים מרוכז במערכת"
              fill
              className="object-cover"
            />
          </div>
          {/* Second image - medium width (spans 4 columns on desktop) */}
          <div className="relative h-60 overflow-hidden rounded-xl border sm:col-span-4 md:h-80">
            <Image
              src="https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&h=1066&fit=crop"
              alt="עבודה על פניות מכל הערוצים"
              fill
              className="object-cover"
            />
          </div>
          {/* Third image - narrowest (spans 2 columns on desktop) */}
          <div className="relative h-60 overflow-hidden rounded-xl border sm:col-span-3 md:h-80">
            <Image
              src="https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=600&h=800&fit=crop"
              alt="מעקב אחרי לידים"
              fill
              className="object-cover"
            />
          </div>
        </div>

        <h2 className="mt-8 max-w-3xl text-4xl leading-none font-semibold tracking-tight md:mt-12 lg:mt-16 lg:text-5xl">
          הלידים מגיעים מכל מקום. העבודה עליהם צריכה לקרות במקום אחד.
        </h2>

        {/* Stats Grid - Left Aligned */}
        <div className="mt-8 grid grid-cols-2 gap-8 md:grid-cols-3 lg:mt-12 lg:gap-12">
          {stats.map((stat, index) => (
            <div key={index} className="border-input border-b">
              <div className="text-3xl font-semibold md:text-4xl lg:text-5xl">
                {stat.number}
              </div>
              <div className="text-muted-foreground my-6 text-sm md:text-base">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
