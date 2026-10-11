# Sổ Tay Kiểm Soát Code: Tính Năng Đóng Dấu Logo / Watermark (Issue #29)

> **Mục tiêu:** Bản tóm tắt gọn gàng, trực quan giúp bạn nắm bắt 100% vị trí các file cần sửa, file cần tạo mới, nội dung cốt lõi và lệnh git tương ứng của từng bước mà không bị rối não.

---

## Bảng Tra Cứu Nhanh Các File Tác Động

| Bước | Tên bước công việc | File SỬA | File TẠO MỚI | Trạng thái |
|:---:|:---|:---|:---|:---:|
| **1** | Định nghĩa Schema & Kiểu dữ liệu | `src/llm/schema.ts`<br>`tests/unit/schema.test.ts` | *(Không có)* | ✅ **Đã xong** |
| **2** | Hàm tính toán bộ lọc FFmpeg | *(Không có)* | `src/pipeline/watermarkFilter.ts`<br>`tests/unit/watermarkFilter.test.ts` | ✅ **Đã xong** |
| **3** | Tích hợp vào Video Renderer | `src/pipeline/renderer.ts` | *(Không có)* | ⏳ Chờ làm |
| **4** | Nối dữ liệu qua Orchestrator | `src/pipeline/orchestrator.ts` | *(Không có)* | ⏳ Chờ làm |
| **5** | API Tải Logo lên & Chống mã độc | `package.json`<br>`src/index.ts` | `src/security/uploadGuard.ts`<br>`tests/unit/uploadGuard.test.ts` | ⏳ Chờ làm |
| **6** | Lưu cài đặt vào Database PostgreSQL | `src/database/base.ts`<br>`src/index.ts` | `src/database/brandKit.ts` | ⏳ Chờ làm |
| **7** | Giao diện Web Studio & Xem thử | `frontend/index.html`<br>`frontend/style.css`<br>`frontend/app.js` | *(Không có)* | ⏳ Chờ làm |
| **8** | Kiểm thử toàn trình E2E & Tài liệu | `docs/api.md` | `tests/integration/watermark.test.ts` | ⏳ Chờ làm |

---

## BƯỚC 1: Định Nghĩa Schema & Kiểu Dữ Liệu (ĐÃ XONG ✅)

* **Mục tiêu:** Tạo quy tắc kiểm tra dữ liệu logo (vị trí 4 góc, kích thước 5–50%, độ mờ 10–100%).
* **Các file tác động:**
  1. `src/llm/schema.ts` **(SỬA)**:
     - *Đoạn sửa:* Thêm `watermarkPositionSchema`, `watermarkConfigSchema`, và gắn trường `watermark` vào `videoRequestSchema`, `renderOptions`.
  2. `tests/unit/schema.test.ts` **(SỬA)**:
     - *Đoạn sửa:* Thêm nhóm test `TC-SCH-005` kiểm tra giá trị mặc định, kiểm tra 4 góc, và chặn giá trị ngoài khoảng.
* **Lệnh kiểm tra:** `node.exe --import tsx tests/unit/schema.test.ts` *(Kết quả: 23/23 tests pass)*
* **Lệnh lưu Git (Commit):**
  ```bash
  git add src/llm/schema.ts tests/unit/schema.test.ts tomtat.md
  git commit -m "feat(schema): định nghĩa khuôn mẫu dữ liệu cho tính năng đóng dấu logo"
  git push origin tuan
  ```

---

## BƯỚC 2: Viết Hàm Tính Bộ Lọc FFmpeg Logo (ĐÃ XONG ✅)

* **Mục tiêu:** Viết hàm độc lập tính toán câu lệnh FFmpeg (scale giữ tỉ lệ gốc, chỉnh độ mờ Alpha, tính tọa độ 4 góc có lùi mép).
* **Các file tác động:**
  1. `src/pipeline/watermarkFilter.ts` **(TẠO MỚI)**:
     - *Nội dung:* Tạo hàm `buildWatermarkFilter(config, width, height)` trả về chuỗi bộ lọc `-filter_complex`.
     - *Quy tắc quan trọng:* Chiều cao logo để `-1` để FFmpeg tự giữ nguyên tỷ lệ gốc, không làm méo logo.
  2. `tests/unit/watermarkFilter.test.ts` **(TẠO MỚI)**:
     - *Nội dung:* 7 nhóm test (TC-WMF-001 → TC-WMF-007) kiểm tra tọa độ 4 góc, tọa độ custom, scale, opacity clamp, cấu trúc output, padding và nhãn luồng.
* **Lệnh kiểm tra:** `node.exe --import tsx tests/unit/watermarkFilter.test.ts` *(Kết quả: 21/21 tests pass)*
* **Lệnh lưu Git (Commit):**
  ```bash
  git add src/pipeline/watermarkFilter.ts tests/unit/watermarkFilter.test.ts
  git commit -m "feat(pipeline): tao module tinh toan bo loc logo ffmpeg kem kiem thu tu dong"
  git push origin tuan
  ```

---

## BƯỚC 3: Tích Hợp Đóng Dấu Logo Vào Video Renderer (KẾ TIẾP ⏳)

* **Mục tiêu:** Cập nhật bộ xuất video để khi có logo thì tự động nạp ảnh logo và ghép vào video qua FFmpeg.
* **Các file tác động:**
  1. `src/pipeline/renderer.ts` **(SỬA)**:
     - *Nội dung sửa:* 
       - Nhận thêm `watermark?: WatermarkConfig` trong `RenderVideoOptions`.
       - Trong mảng `ffmpegArgs`: Nếu có logo thì chèn thêm `-i watermark.logoPath` và `-filter_complex` gọi hàm từ Bước 2.
       - Chỉ định `-map "[outv]"` để lấy luồng hình ảnh đã dán logo.
* **Lệnh kiểm tra:** `node.exe --import tsx tests/unit/schema.test.ts`
* **Lệnh lưu Git (Commit):**
  ```bash
  git add src/pipeline/renderer.ts
  git commit -m "feat(render): tich hop bo loc logo vao tien trinh xuat video ffmpeg"
  git push origin tuan
  ```

---

## BƯỚC 4: Nối Dữ Liệu Qua Bộ Điều Phối Quy Trình (Orchestrator)

* **Mục tiêu:** Truyền thông suốt cấu hình logo từ yêu cầu của người dùng xuống hàm `renderVideo`.
* **Các file tác động:**
  1. `src/pipeline/orchestrator.ts` **(SỬA)**:
     - *Nội dung sửa:* Tại Giai đoạn 7 (Phase 7 - Render video), truyền `watermark: request.watermark` vào hàm `renderVideo`.
* **Lệnh lưu Git (Commit):**
  ```bash
  git add src/pipeline/orchestrator.ts
  git commit -m "feat(pipeline): truyen cau hinh logo tu yeu cau qua bo dieu phoi xuat video"
  git push origin tuan
  ```

---

## BƯỚC 5: API Tải Logo Lên & Bộ Lọc Khử Mã Độc (SVG / File Security)

* **Mục tiêu:** Cho phép người dùng upload logo an toàn; chặn đứng nguy cơ tải mã độc qua tệp SVG (chống XSS & XXE).
* **Các file tác động:**
  1. `package.json` **(SỬA)**: Cài thêm gói `@fastify/multipart`.
  2. `src/security/uploadGuard.ts` **(TẠO MỚI)**:
     - *Nội dung:* Viết hàm `sanitizeSvg` cắt bỏ các thẻ `<script>`, sự kiện `onload`, `onclick` và chặn thực thể XML ngoài (XXE).
  3. `tests/unit/uploadGuard.test.ts` **(TẠO MỚI)**:
     - *Nội dung:* Viết unit test xác nhận hàm chặn đứng mọi mã độc thử nghiệm.
  4. `src/index.ts` **(SỬA)**:
     - *Nội dung sửa:* Đăng ký `@fastify/multipart` (giới hạn 5MB) và thêm route `POST /api/brand-kit/upload` lưu ảnh với tên ngẫu nhiên UUID.
* **Lệnh kiểm tra:** `node.exe --import tsx tests/unit/uploadGuard.test.ts`
* **Lệnh lưu Git (Commit):**
  ```bash
  git add package.json package-lock.json src/security/uploadGuard.ts tests/unit/uploadGuard.test.ts src/index.ts
  git commit -m "feat(api): tao api tai logo len kem bo loc khu doc ma svg an toan"
  git push origin tuan
  ```

---

## BƯỚC 6: Lưu Cài Đặt Logo Vào Cơ Sở Dữ Liệu PostgreSQL

* **Mục tiêu:** Ghi nhớ logo và vị trí ưa thích của tài khoản người dùng để không phải cài đặt lại ở các lần sau.
* **Các file tác động:**
  1. `src/database/base.ts` **(SỬA)**:
     - *Nội dung sửa:* Thêm câu lệnh SQL `CREATE TABLE IF NOT EXISTS brand_kits` liên kết với `user_id`.
  2. `src/database/brandKit.ts` **(TẠO MỚI)**:
     - *Nội dung:* Viết 2 hàm `getBrandKitByUserId` (lấy cài đặt) và `upsertBrandKit` (lưu cài đặt bằng câu lệnh gộp `ON CONFLICT DO UPDATE`).
  3. `src/index.ts` **(SỬA)**:
     - *Nội dung sửa:* Thêm 2 route `GET /api/user/brand-kit` và `PUT /api/user/brand-kit`.
* **Lệnh lưu Git (Commit):**
  ```bash
  git add src/database/base.ts src/database/brandKit.ts src/index.ts
  git commit -m "feat(db): luu tru cai dat logo va thuong hieu nguoi dung vao postgresql"
  git push origin tuan
  ```

---

## BƯỚC 7: Xây Dựng Giao Diện Web Studio & Xem Thử Trực Tiếp

* **Mục tiêu:** Cung cấp giao diện trực quan cho người dùng chọn ảnh logo, chọn 4 góc, kéo thanh trượt to nhỏ và xem thử ngay trên màn hình.
* **Các file tác động:**
  1. `frontend/index.html` **(SỬA)**:
     - *Nội dung sửa:* Thêm thẻ `<details>` gồm: nút chọn ảnh logo, lưới 4 nút chọn góc, thanh kéo Scale (5–40%), thanh kéo Opacity (10–100%).
  2. `frontend/style.css` **(SỬA)**:
     - *Nội dung sửa:* Thêm định dạng CSS cho lưới nút chọn góc và thanh trượt.
  3. `frontend/app.js` **(SỬA)**:
     - *Nội dung sửa:* Bắt sự kiện kéo thanh trượt để cập nhật hình ảnh xem thử (Live Preview), và gửi kèm object `watermark` trong payload khi bấm nút "Tạo Video".
* **Lệnh lưu Git (Commit):**
  ```bash
  git add frontend/index.html frontend/style.css frontend/app.js
  git commit -m "feat(ui): them giao dien tuy chinh logo va xem truoc truc tiep tren web"
  git push origin tuan
  ```

---

## BƯỚC 8: Kiểm Thử Toàn Trình (E2E) & Cập Nhật Tài Liệu

* **Mục tiêu:** Chạy thử xuất video thực tế có logo và cập nhật tài liệu kỹ thuật của dự án.
* **Các file tác động:**
  1. `tests/integration/watermark.test.ts` **(TẠO MỚI)**:
     - *Nội dung:* Gọi hàm `renderVideo` thật với ảnh logo mẫu, khẳng định file `final_video.mp4` sinh ra thành công và dung lượng hợp lệ (> 10KB).
  2. `docs/api.md` **(SỬA)**:
     - *Nội dung sửa:* Bổ sung tài liệu mô tả các trường `watermark` trong API tạo video.
* **Lệnh kiểm tra:** `node.exe --import tsx tests/integration/watermark.test.ts`
* **Lệnh lưu Git (Commit):**
  ```bash
  git add tests/integration/watermark.test.ts docs/api.md
  git commit -m "test(integration): kiem thu toan trinh xuat video co logo va cap nhat tai lieu api"
  git push origin tuan
  ```
