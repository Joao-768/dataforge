import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
    output: 'standalone',
    poweredByHeader: false,
    reactStrictMode: true,
    // Native and stream-heavy server packages stay as runtime requires instead
    // of being bundled.
    serverExternalPackages: ['pg', 'pg-cursor', 'pino', 'nodemailer', 'csv-parse', 'csv-stringify'],
    async headers() {
        return [
            {
                source: '/:path*',
                headers: [
                    { key: 'X-Content-Type-Options', value: 'nosniff' },
                    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
                    { key: 'X-Frame-Options', value: 'DENY' },
                    {
                        key: 'Permissions-Policy',
                        value: 'camera=(), microphone=(), geolocation=(), payment=()',
                    },
                ],
            },
        ]
    },
}

export default nextConfig
