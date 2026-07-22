# Ops API + scrapers (Puppeteer). Build context = this repo root (backend/).
FROM node:22-bookworm-slim

# Chromium system libraries (Puppeteer downloads its own browser binary)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    tzdata \
    wget \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

ENV TZ=Europe/Belgrade

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer
ENV NODE_ENV=production

RUN npx prisma generate \
  && npm run puppeteer:install \
  && mkdir -p /app/data

# Render sets PORT; app.ts reads process.env.PORT
EXPOSE 10000

CMD ["npm", "start"]
