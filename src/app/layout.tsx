import type { Metadata, Viewport } from 'next'
import { GeistMono } from 'geist/font/mono'
import { GeistSans } from 'geist/font/sans'
import { headers } from 'next/headers'
import { Providers } from '@/components/providers'
import './globals.css'

export const metadata: Metadata = {
    title: { default: 'DataForge', template: '%s · DataForge' },
    description:
        'A visual PostgreSQL studio: design schemas on a canvas, generate and apply migrations, run SQL safely and explore data.',
    icons: { icon: '/favicon.svg' },
}

export const viewport: Viewport = {
    themeColor: '#000000',
    colorScheme: 'dark light',
}

export default async function RootLayout({ children }: LayoutProps<'/'>) {
    // The proxy generates a nonce per request; Next.js applies it to its own
    // scripts, and the theme script needs it too.
    const nonce = (await headers()).get('x-nonce') ?? undefined
    return (
        <html
            lang="en"
            data-theme="dark"
            className={`${GeistSans.variable} ${GeistMono.variable}`}
            suppressHydrationWarning
        >
            <head>
                <script src="/theme.js" nonce={nonce} />
            </head>
            <body>
                <Providers>{children}</Providers>
            </body>
        </html>
    )
}
