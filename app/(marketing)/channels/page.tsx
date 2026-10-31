import { buildPageMetadata } from '@/lib/seo/metadata'
import { ThemeProvider } from '@/components/lumen/theme-provider'
import Navbar from '@/components/lumen/layout/navbar'
import Footer from '@/components/lumen/layout/footer'
import AboutHero from '@/components/lumen/sections/about-hero'
import BenefitsShowcase from '@/components/lumen/sections/benefits-showcase'
import VideoShowcase from '@/components/lumen/sections/video-showcase'
import TeamShowcase from '@/components/lumen/sections/team-showcase'
import WhyWeBegan from '@/components/lumen/sections/why-we-began'

export const metadata = buildPageMetadata({
  path: '/channels',
  title: 'ערוצים | SocialCRM | פייסבוק, אינסטגרם ווואטסאפ במקום אחד',
  description:
    'איך SocialCRM מחברת את הערוצים שמהם מגיעים הלידים: טפסי Lead Ads מפייסבוק ומאינסטגרם נכנסים אוטומטית, שיחות וואטסאפ מתחברות לליד עם סימוני נמסר ונקרא, והכול מגיע לרשימה אחת עם סטטוס, נציג ותאריך מעקב.',
  ogTitle: 'כל הערוצים במקום אחד | SocialCRM',
  ogDescription:
    'פייסבוק, אינסטגרם ווואטסאפ נכנסים לרשימה אחת, עם שיחה, סטטוס ומעקב על כל פנייה.',
})

/**
 * `/channels` is Lumen's About page, transformed. Section order, layout,
 * spacing, typography and animation are the template's own implementation;
 * only the copy and the channel-specific assets are SocialCRM's.
 */
export default function ChannelsPage() {
  return (
    <ThemeProvider
      attribute='class'
      defaultTheme='light'
      enableSystem={false}
      disableTransitionOnChange
    >
      <div className='lumen' dir='rtl'>
        <Navbar initialBannerVisible={false} />
        <AboutHero />
        <BenefitsShowcase />
        <VideoShowcase />
        <TeamShowcase />
        <WhyWeBegan />
        <Footer />
      </div>
    </ThemeProvider>
  )
}
