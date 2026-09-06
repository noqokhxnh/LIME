FROM node:20-slim

# Cài đặt FFmpeg (cho muxing audio/video)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy các file cấu hình package trước để tận dụng Docker cache
COPY package*.json ./
RUN npm install

# Cài đặt trình duyệt Playwright (chỉ tải Chromium và các thư viện hệ thống cần thiết)
RUN npx playwright install --with-deps chromium

# Copy toàn bộ mã nguồn vào container
COPY . .

# Build mã nguồn TypeScript
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
