# Issue #104: Port 51 Visual Style Presets từ Lemo-Opuscar

## 1. Vấn đề

LIME hiện đang thiếu visual styles engine toàn diện (liên quan issue #22) để định hướng phong cách hình ảnh, ánh sáng, vật liệu, bảng màu và nhịp điệu chuyển động cho các video do AI sinh ra. Trong khi đó, dự án nguồn mở `lemo-opuscar` của `lemomo-ai` sở hữu bộ sưu tập 51 visual style prompts chất lượng cao và chi tiết, được phát hành dưới giấy phép MIT License cho phép sử dụng và tích hợp thương mại. Việc port 51 style prompts này vào LIME sẽ cung cấp thư viện phong cách phong phú, chuẩn hóa cho pipeline sinh kịch bản và đồ họa video.

## 2. Tài liệu liên quan

- Kho mã nguồn gốc: [lemomo-ai/lemo-opuscar](https://github.com/lemomo-ai/lemo-opuscar)
- Cấu trúc tài liệu `STYLE.md` trong mỗi thư mục style của lemo-opuscar: đặc tả chi tiết về bản chất (essence), bảng màu, ánh sáng, chất liệu, vật lý và cách render camera/chuyển động.
- Cấu trúc `style.json` đi kèm: metadata định danh phong cách (slug, tên tiếng Anh, tên tiếng Trung, danh mục, kịch bản mẫu và các trường hợp ứng dụng).
- Điều khoản cấp phép MIT License: cho phép sao chép, sửa đổi, phân phối và sử dụng thương mại với điều kiện giữ nguyên thông tin bản quyền và ghi nhận tác giả (attribution).

## 3. Thiết kế

### 3.1. Cấu trúc thư mục

Các tài nguyên style preset được tổ chức tập trung trong thư mục `src/templates/styles/`:
- `src/templates/styles/presets/<slug>.md`: Chứa nội dung prompt phong cách tương ứng từ `STYLE.md`, được sao chép NGUYÊN VĂN từ repo nguồn nhằm đảm bảo giữ trọn vẹn chất lượng mô tả visual grammar của tác giả gốc.
- `src/templates/styles/index.json`: File tổng hợp metadata của cả 51 styles (được trích xuất từ các file `style.json` tương ứng), bao gồm: `slug`, `name_en`, `name_cn`, `category_en`, `category_cn`, `uses`.
- `src/templates/styles/index.ts`: Module loader cung cấp API tra cứu và nạp prompt tiện lợi cho pipeline:
  - `listStyles()`: Đọc và trả về danh sách metadata của 51 style presets.
  - `getStylePrompt(slug: string)`: Đọc và trả về toàn bộ nội dung markdown của preset `presets/<slug>.md`; ném lỗi nếu `slug` không hợp lệ. Chỉ dùng module chuẩn `fs`/`path` của Node.js, không cài thêm dependency bên ngoài.
- `src/templates/styles/CREDITS.md`: Ghi rõ nguồn gốc style prompts từ `lemomo-ai/lemo-opuscar`, kèm đường dẫn và điều khoản MIT License.
- **Ranh giới kỹ thuật**: Mã nguồn demo film (`film.js`, `engine.js`, ...) và tài nguyên media demo của repo gốc TUYỆT ĐỐI KHÔNG được copy sang LIME để tránh làm phình repo và giữ nguyên kiến trúc render HTML/GSAP hiện tại của LIME.

### 3.2. Tích hợp trong hệ thống LIME

Module loader `src/templates/styles/index.ts` sẽ đóng vai trò là single source of truth cho các style presets, cho phép LLM script generator hoặc người dùng lựa chọn visual style để định hình kịch bản video.

## 4. Kế hoạch test

Xây dựng test suite đơn vị chuyên biệt tại `tests/unit/styles_presets.test.ts` (và đăng ký vào `FAST` trong `scripts/test-groups.ts`):
- Kiểm tra tính hợp lệ của `src/templates/styles/index.json`: parse JSON thành công, chứa chính xác 51 entries.
- Kiểm tra tính toàn vẹn 2 chiều giữa metadata và file hệ thống:
  - Mọi `slug` trong `index.json` đều tồn tại file `src/templates/styles/presets/<slug>.md`.
  - Mọi file `.md` trong `src/templates/styles/presets/` đều có entry tương ứng trong `index.json` (không thừa, không thiếu).
- Kiểm tra module loader `src/templates/styles/index.ts`:
  - Hàm `listStyles()` trả về đúng mảng 51 phần tử với đầy đủ các trường metadata hợp lệ.
  - Hàm `getStylePrompt(slug)` trả về chuỗi nội dung không rỗng đối với các slug mẫu, đồng thời ném ngoại lệ khi truyền slug không tồn tại.

## 5. Tiêu chí nghiệm thu

1. Đầy đủ 51 file preset tại `src/templates/styles/presets/<slug>.md`.
2. Kiểm tra dòng lệnh: số dòng (`wc -l`) của từng file đích phải khớp tuyệt đối 100% với file `STYLE.md` gốc tương ứng.
3. Metadata `index.json`, loader `index.ts` và ghi nhận tác quyền `CREDITS.md` đầy đủ, chuẩn xác.
4. Bộ test tự động `tests/unit/styles_presets.test.ts` pass 100% và toàn bộ suite `npm test` (hoặc `npm run test:unit`) xanh.
