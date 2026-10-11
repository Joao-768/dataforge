# syntax=docker/dockerfile:1.7
#
# DataForge production image: Next.js standalone server on Node 24, running
# as an unprivileged user. Application migrations run at startup
# (src/instrumentation.ts), so the image needs only DATABASE_URL and the
# target-server settings to come up.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Install scripts are skipped; the one this project defines (copying Monaco
# into public/) runs explicitly in the build stage.
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN node scripts/copy-monaco.mjs && npx next build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3300 \
    HOSTNAME=0.0.0.0
RUN addgroup -S -g 1001 dataforge \
    && adduser -S -u 1001 -G dataforge dataforge \
    && mkdir -p /var/lib/dataforge/secrets /app/.next/cache \
    && chown -R dataforge:dataforge /var/lib/dataforge /app/.next
COPY --from=build --chown=dataforge:dataforge /app/.next/standalone ./
COPY --from=build --chown=dataforge:dataforge /app/.next/static ./.next/static
COPY --from=build --chown=dataforge:dataforge /app/public ./public
COPY --from=build --chown=dataforge:dataforge /app/db ./db
USER dataforge
EXPOSE 3300
CMD ["node", "server.js"]
