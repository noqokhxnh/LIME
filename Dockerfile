FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y \
    ffmpeg \
    chromium \
    fonts-noto-core \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

RUN mkdir -p /app/tmp && chown -R node:node /app
USER node

EXPOSE 3000

CMD ["npm", "start"]
