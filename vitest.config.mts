import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const root = path.dirname(fileURLToPath(import.meta.url))

const alias = {
    '@': path.resolve(root, 'src'),
    // Next.js resolves this to an empty module on the server; tests run
    // server modules directly.
    'server-only': path.resolve(root, 'tests/support/empty.ts'),
}

export default defineConfig({
    resolve: { alias },
    test: {
        projects: [
            {
                resolve: { alias },
                test: {
                    name: 'unit',
                    include: ['tests/unit/**/*.test.ts'],
                    environment: 'node',
                },
            },
            {
                plugins: [react()],
                resolve: { alias },
                test: {
                    name: 'components',
                    include: ['tests/components/**/*.test.tsx'],
                    environment: 'jsdom',
                    setupFiles: ['tests/support/setup-dom.ts'],
                },
            },
            {
                resolve: { alias },
                test: {
                    name: 'integration',
                    include: ['tests/integration/**/*.test.ts'],
                    environment: 'node',
                    globalSetup: ['tests/support/global-setup.ts'],
                    setupFiles: ['tests/support/setup-integration.ts'],
                    testTimeout: 60_000,
                    hookTimeout: 120_000,
                    // Files share one PostgreSQL container; run them one at a time.
                    fileParallelism: false,
                },
            },
        ],
    },
})
