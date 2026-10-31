'use client';

import { Play } from 'lucide-react';
import { useState } from 'react';

import Noise from '@/components/lumen/noise';

export default function VideoShowcase() {
  const [isPlaying, setIsPlaying] = useState(false);

  const handlePlay = () => {
    setIsPlaying(true);
    // You can add video play logic here
  };

  return (
    <section className="section-padding relative">
      <Noise />
      <div className="bigger-container">
        <span className="text-muted-foreground mb-4 text-sm font-semibold tracking-wide uppercase">
          הערוצים
        </span>
        <div className="flex flex-col justify-between gap-4 md:flex-row xl:gap-8">
          <h2 className="max-w-2xl text-4xl leading-none font-semibold tracking-tight lg:text-5xl">
            מהמודעה ועד הסגירה, בלי לעבור בין אפליקציות
          </h2>
          <p className="max-w-lg">
            ליד שנכנס מפייסבוק, מאינסטגרם או מוואטסאפ מקבל מיד מקום ברשימה,
            סטטוס ותאריך מעקב. משם ממשיכים את השיחה, מעדכנים את הסטטוס
            וסוגרים, הכול מאותו מסך.
          </p>
        </div>
        {/* Video Section */}
        <div className="mt-8 lg:mt-12">
          <div className="bg-muted relative aspect-video w-full overflow-hidden rounded-xl border">
            {!isPlaying ? (
              <>
                {/* Video Thumbnail/Background */}
                <div
                  className="absolute inset-0 bg-cover bg-center"
                  style={{
                    backgroundImage:
                      'url(/media/video/channels-poster.jpg)',
                  }}
                >
                  {/* Dark overlay */}
                  <div className="absolute inset-0 bg-black/30" />
                </div>

                {/* Custom Play Button */}
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                  <button
                    onClick={handlePlay}
                    className="group flex h-20 w-20 cursor-pointer items-center justify-center rounded-full bg-white shadow-lg transition-all duration-300 hover:scale-103 hover:shadow-xl lg:h-24 lg:w-24"
                    aria-label="ניגון הסרטון"
                  >
                    <Play className="ml-1 size-6 fill-black text-black lg:size-7" />
                  </button>
                  <span className="font-semibold text-white">צפו בסרטון</span>
                </div>
              </>
            ) : (
              <video
                className="h-full w-full object-cover"
                controls
                autoPlay
                playsInline
                poster="/media/video/channels-poster.jpg"
              >
                <source src="/media/video/channels.mp4" type="video/mp4" />
                הדפדפן שלכם לא תומך בניגון וידאו.
              </video>
            )}
          </div>

          {/* Description */}
          <p className="text-muted-foreground mx-auto mt-4 text-center md:mt-8 md:text-lg">
            כך זה נראה בפועל: פנייה שנכנסת, שיחה שממשיכה ממנה, וסטטוס שמתעדכן
            עד הסגירה.
          </p>
        </div>
      </div>
    </section>
  );
}
