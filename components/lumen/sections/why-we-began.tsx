'use client';

import { MailIcon } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import Noise from '@/components/lumen/noise';
import { TRIAL_LENGTH_DAYS } from '@/lib/trial';
import { Button } from '@/components/lumen/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/lumen/ui/card';

const stats = [
  { value: '3', label: 'ערוצים, רשימה אחת' },
  { value: String(TRIAL_LENGTH_DAYS), label: 'ימי ניסיון במערכת המלאה' },
];

// Product facts, not performance claims: the Meta connection, the WhatsApp
// message-status vocabulary in lib/whatsapp, and the follow-up rule the
// briefing applies.
const performanceStats = [
  {
    value: 'פייסבוק',
    description:
      'מחברים את הדף העסקי פעם אחת, וכל טופס Lead Ads שמתמלא נכנס למערכת תוך שניות, עם השם, הטלפון והמקור. בלי ייצוא ידני ובלי קובץ שצריך להוריד פעמיים ביום.',
  },
  {
    value: 'אינסטגרם',
    description:
      'טפסי הלידים ממודעות אינסטגרם עוברים באותו חיבור ל-Meta ונכנסים לאותה רשימה. הודעות ישירות באינסטגרם לא נאספות אוטומטית, ואת הפנייה מוסיפים ידנית.',
  },
  {
    value: 'וואטסאפ',
    description:
      'כל שיחה מחוברת לליד שלה ונשמרת עליו. עונים מהמערכת, רואים מתי ההודעה נמסרה ומתי נקראה, ולפנייה חוזרת אחרי 24 שעות שולחים תבנית מאושרת של Meta.',
  },
];

export default function WhyWeBegan() {
  return (
    <section className="section-padding relative overflow-x-clip">
      <Noise />
      <div className="bigger-container">
        <div className="flex flex-col-reverse items-center gap-8 md:flex-row lg:gap-12">
          <div className="relative h-full w-full md:w-[453px]">
            {/* Background gradient circles */}
            <div className="bg-chart-2 absolute top-0 left-0 size-60 -translate-x-1/6 rounded-full opacity-30 blur-[80px] will-change-transform md:opacity-70" />
            <div className="bg-chart-3 absolute right-0 bottom-0 size-60 -translate-x-1/4 translate-y-1/6 rounded-full opacity-50 blur-[80px] will-change-transform md:opacity-70" />

            <div className="relative aspect-square size-full overflow-hidden rounded-xl">
              <Image
                src="/media/hero-leads-demo.png"
                alt="רשימת הלידים במערכת SocialCRM"
                fill
                className="rounded-xl object-cover"
              />
            </div>
          </div>

          {/* Content Section */}
          <div className="flex-1 space-y-6 lg:space-y-8">
            <div className="space-y-8 lg:space-y-12">
              <h2 className="text-3xl leading-none font-semibold tracking-tight lg:text-4xl">
                למה זה בנוי ככה
              </h2>
              <div>
                <p>
                  ליד שנכנס מפייסבוק, פנייה שמגיעה מאינסטגרם והודעה שנוחתת
                  בוואטסאפ יכולים להיות אותו אדם, אבל בלי מערכת הם שלושה מקומות נפרדים
                  שלא מכירים זה את זה.
                </p>
                <br />
                <p>
                  לכן הערוצים לא מנוהלים כאן בנפרד. כולם נכנסים לרשימה אחת, ולכל
                  פנייה יש מקור, שיחה, סטטוס ותאריך לחזור אליה.
                </p>
              </div>
            </div>

            {/* Stats Cards */}
            <div className="flex flex-1 flex-wrap gap-4">
              {stats.map((stat, index) => (
                <Card
                  key={index}
                  className="min-w-[200px] flex-1 gap-0 text-center"
                >
                  <CardHeader>
                    <CardTitle className="text-4xl font-semibold">
                      {stat.value}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-base">{stat.label}</CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>

        {/* Pro Access Section */}
        <div className="mt-16 grid items-center gap-8 lg:mt-24 lg:grid-cols-2 lg:gap-12">
          {/* Content Section */}
          <div className="flex-1 space-y-6 lg:space-y-8">
            <div className="space-y-8 lg:space-y-12">
              <h2 className="text-3xl leading-none font-semibold tracking-tight lg:text-4xl">
                מהפנייה הראשונה ועד הסגירה
              </h2>
              <div className="">
                <p>
                  אחרי שהפנייה נכנסה, היא מקבלת סטטוס, נציג ותאריך לחזור אליה.
                  מי שממתין לתשובה מעל 24 שעות חוזר מעצמו לרשימה של היום, כדי
                  שאף אחד לא ייפול בין הכיסאות.
                </p>
                <br />
                <p>
                  משם ממשיכים באותו מסך: עונים בוואטסאפ, מעדכנים סטטוס, מוסיפים
                  הערה וסוגרים. בתוכנית Pro ה-AI גם קורא את ההיסטוריה ומציע את
                  הצעד הבא.
                </p>
              </div>
            </div>

            {/* CTA Buttons */}
            <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
              <Button className="!text-sm shadow-none" size="lg" asChild>
                <Link href="/">איך זה עובד</Link>
              </Button>
              <Button
                variant="outline"
                className="border-input !text-sm shadow-none"
                size="lg"
                asChild
              >
                <Link href="mailto:alamayo274@gmail.com">
                  דברו איתנו
                  <MailIcon className="size-4" />
                </Link>
              </Button>
            </div>
          </div>

          {/* Images Grid */}
          <div className="grid gap-4">
            {/* First row - 2 images */}
            <div className="grid grid-cols-2 gap-4">
              <div className="relative h-48 overflow-hidden rounded-lg">
                <Image
                  src="https://images.unsplash.com/photo-1521737604893-d14cc237f11d?w=800&h=800&fit=crop"
                  alt="פניות מכל הערוצים"
                  width={300}
                  height={200}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="relative h-48 overflow-hidden rounded-lg">
                <Image
                  src="https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&h=800&fit=crop"
                  alt="מעקב אחרי לידים"
                  width={300}
                  height={200}
                  className="h-full w-full object-cover"
                />
              </div>
            </div>
            <div className="relative h-72 overflow-hidden rounded-lg">
              {/* Second row - 1 full width image */}
              <Image
                src="https://images.unsplash.com/photo-1587825140708-dfaf72ae4b04?w=1600&h=800&fit=crop"
                alt="ניהול לידים במקום אחד"
                width={600}
                height={256}
                className="h-full w-full rounded-lg object-cover"
              />
            </div>
          </div>
        </div>

        {/* Performance Statistics Cards */}
        <div className="section-padding grid gap-4 !pb-0 md:grid-cols-3">
          {performanceStats.map((stat, index) => (
            <Card key={index} className="bg-border md:gap-10">
              <CardHeader>
                <CardTitle className="text-3xl font-semibold">
                  {stat.value}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="">
                  {stat.description}
                </CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
