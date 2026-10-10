// Runs once when the Next.js server starts.
export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const { bootstrap } = await import('@/server/bootstrap')
        await bootstrap()
    }
}
