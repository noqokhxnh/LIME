FROM mcr.microsoft.com/playwright:v1.62.1-jammy

RUN apt-get update && apt-get install -y \
    ffmpeg \
    fonts-noto \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
