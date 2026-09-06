# Hướng dẫn đóng góp (Contributing)

Dưới đây là một số hướng dẫn để quá trình đóng góp của bạn diễn ra suôn sẻ và hiệu quả.

## Môi trường phát triển

Để bắt đầu phát triển, bạn cần cài đặt các công cụ sau:
- Node.js (phiên bản mới nhất được khuyến nghị, >= 18)
- Cài đặt `ffmpeg` trên hệ thống vì dự án sử dụng `fluent-ffmpeg` để xử lý video.
- NPM hoặc Yarn

### Cài đặt dự án

1. Clone repository về máy:
   ```bash
   git clone https://github.com/noqokhxnh/html-to-vid
   cd html-to-vid
   ```

2. Cài đặt các gói phụ thuộc:
   ```bash
   npm install
   ```

3. Copy file `.env.example` thành `.env` (nếu có) và điền các cấu hình môi trường cần thiết:
   ```bash
   cp .env.example .env
   ```

## Các lệnh thường dùng

Dự án sử dụng TypeScript và `tsx` cho môi trường dev.

- **Khởi chạy môi trường phát triển (có hot-reload):**
  ```bash
  npm run dev
  ```
- **Chạy dự án:**
  ```bash
  npm start
  ```
- **Biên dịch TypeScript sang JavaScript (thư mục dist):**
  ```bash
  npm run build
  ```
- **Chạy test (Integration tests):**
  ```bash
  npm test
  ```

## Quy trình làm việc (Workflow)

1. **Tạo branch mới**:
   Tạo branch mới từ branch `main` (hoặc `master`). Đặt tên branch rõ ràng thể hiện tính năng hoặc lỗi bạn đang sửa.
   Ví dụ:
   - `feat/add-new-tts-engine`
   - `fix/ffmpeg-rendering-bug`
   - `docs/update-readme`

   ```bash
   git checkout -b <tên-branch-của-bạn>
   ```

2. **Code và Test**:
   - Viết code của bạn. Đảm bảo tuân thủ TypeScript conventions.
   - Thêm tests nếu có thể và đảm bảo chạy lệnh `npm test` thành công mà không có lỗi.

3. **Commit changes**:
   Chúng tôi khuyến nghị sử dụng quy chuẩn [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).
   Các loại commit phổ biến:
   - `feat:` (tính năng mới)
   - `fix:` (sửa lỗi)
   - `docs:` (tài liệu)
   - `refactor:` (tái cấu trúc code)
   - `test:` (thêm/sửa test)
   - `chore:` (cập nhật các file cấu hình, dependencies, etc.)

   Ví dụ:
   ```bash
   git commit -m "feat: add support for OpenAI TTS"
   ```

4. **Tạo Pull Request (PR)**:
   - Push branch của bạn lên repository.
   - Tạo Pull Request giải thích rõ những thay đổi bạn đã thực hiện, vấn đề nào đã được giải quyết.
   - Đảm bảo CI pipeline (nếu có) pass.

## Báo cáo lỗi (Issues)

Nếu bạn tìm thấy lỗi, vui lòng tạo một Issue và cung cấp:
- Mô tả chi tiết lỗi (expected behavior và actual behavior).
- Các bước để tái hiện (Steps to reproduce).
- Phiên bản Node, OS và các thư viện liên quan.
- Log lỗi chi tiết nếu có.

## Đề xuất tính năng (Feature Requests)

Chúng tôi luôn chào đón các ý tưởng mới! Nếu bạn có đề xuất tính năng:
- Mở một Issue và sử dụng nhãn `enhancement` hoặc thêm tiền tố `[Feature]` ở tiêu đề.
- Giải thích rõ tại sao tính năng này hữu ích đối với dự án.
- Đưa ra một số ví dụ về cách triển khai hoặc cách nó hoạt động nếu có thể.

---

Cảm ơn bạn đã đồng hành và đóng góp xây dựng `html-to-vid` tốt hơn!
