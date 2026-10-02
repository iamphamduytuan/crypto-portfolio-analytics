import type { Metadata } from 'next'
import { Geist_Mono, Inter, Noto_Sans_JP, Noto_Sans_KR, Noto_Sans_SC } from 'next/font/google'
import { AppProviders } from '@/components/AppProviders'
import './globals.css'

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700'],
})

const notoSc = Noto_Sans_SC({
  variable: '--font-sc',
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  preload: false,
})

const notoJp = Noto_Sans_JP({
  variable: '--font-jp',
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  preload: false,
})

const notoKr = Noto_Sans_KR({
  variable: '--font-kr',
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  preload: false,
})

const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

const themeScript = `(function(){try{var t=localStorage.getItem('portfolio-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='dark'}})()`

export const metadata: Metadata = {
  title: 'Crypto Portfolio Analytics',
  description:
    'Portfolio analytics over an imported trade history: holdings, cost basis, realized and unrealized P&L.',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${notoSc.variable} ${notoJp.variable} ${notoKr.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  )
}
