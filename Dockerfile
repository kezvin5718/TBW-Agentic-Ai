# Stage 1: Install dependencies
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: Rebuild the source code
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Stage 3: Production runner
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# The serif display face for jewellery-editorial posts (OFL, vendored in fonts/).
# Copied in before fc-cache below so the cache is built with it present.
COPY fonts/ /usr/share/fonts/truetype/cormorant/

# Fonts + fontconfig so sharp/librsvg can render SVG <text> (the branding address
# strip). ffmpeg extracts video frames for the Content Hub brand-QC.
# tzdata so the container can actually resolve Asia/Kolkata (Alpine ships none).
RUN apk add --no-cache fontconfig ttf-dejavu ffmpeg tzdata && fc-cache -f

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
# The agency works in Kolkata time; UTC was the default and read 5:30 behind.
ENV TZ="Asia/Kolkata"

CMD ["node", "server.js"]
