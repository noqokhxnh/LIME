FROM mcr.microsoft.com/playwright:v1.62.1-jammy

RUN apt-get update && apt-get install -y \
    ffmpeg \
    fonts-noto \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

RUN chown -R pwuser:pwuser /app
USER pwuser

EXPOSE 3000

CMD ["npm", "start"]
