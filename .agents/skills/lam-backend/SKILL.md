---
name: "lam_backend"
description: "Làm và sửa backend của dự án LIME (Fastify + PostgreSQL trong thư mục src/): thêm/sửa API endpoint, validate dữ liệu bằng zod, kiểm tra đăng nhập bằng getCurrentUser, thao tác database qua tầng src/database/. Dùng khi issue/bước trong phantich.md đụng tới API, logic server hoặc cơ sở dữ liệu."
version: 1.1.0
---

# Làm backend

## Purpose
Thực hiện các việc phía server của LIME đúng chuẩn sẵn có của repo — route theo module, validate bằng zod, auth bằng session, database qua tầng riêng — để endpoint mới viết ra nhất quán với endpoint cũ và không hở lỗi bảo mật căn bản.

## Workflow
1. **Xác định module.** Route thuộc mảng nào: `src/auth/`, `src/billing/`, `src/admin/`, `src/helpdesk/`, hay route lõi trong `src/index.ts`. Sửa/đặt file routes của đúng module đó; module mới thì đăng ký bằng `app.register(...)` trong `src/index.ts`.
2. **Viết zod schema trước.** Mọi dữ liệu vào (body, query) đều có schema `z.object({...})` validate ngay đầu handler — dữ liệu sai trả lỗi 400 kèm thông báo rõ, không cho chạy tiếp vào logic.
3. **Kiểm tra đăng nhập.** Route cần auth thì gọi `getCurrentUser(request)` (từ `src/auth/session.ts`) ngay đầu handler; chưa đăng nhập trả 401. Không tự chế cách kiểm tra đăng nhập khác.
4. **Thao tác database qua `src/database/`.** Mỗi bảng có file/hàm riêng trong tầng này (ví dụ `brandKit.ts`). Viết SQL dạng tham số ($1, $2...) — tuyệt đối không nối chuỗi trực tiếp dữ liệu người dùng vào câu SQL.
5. **Cập nhật tài liệu hợp đồng.** `docs/api.md` là hợp đồng API của dự án (giữ vai trò tương đương tài liệu Swagger/OpenAPI): endpoint mới hoặc đổi hành vi thì cập nhật nó trong cùng bước, ghi rõ method, đường dẫn, dữ liệu vào/ra và mã lỗi.
6. **Kiểm chứng bằng test.** Viết/chạy integration test qua `app.inject()` theo skill `viet-test`; lỗi thì xử lý theo skill `debug-loi`. Pass 100% mới commit.

## Output Contract
Kết quả trả về gồm:
- **File đã sửa/thêm:** đường dẫn + tóm tắt thay đổi từng file.
- **Endpoint đã động tới:** method + đường dẫn + yêu cầu đăng nhập hay không.
- **Kết quả kiểm chứng:** test đã chạy và kết quả (theo skill `viet-test`).

## Operating Rules
1. Không bỏ qua validate vì "dữ liệu này tin được" — mọi input từ client đều phải qua zod.
2. Trả đúng mã HTTP theo tình huống: 400 dữ liệu sai, 401 chưa đăng nhập, 403 không có quyền, 404 không tìm thấy, 500 lỗi server.
3. Không để lộ chi tiết nhạy cảm trong thông báo lỗi trả về client (đường dẫn file nội bộ, stack trace, câu SQL).
4. File người dùng tải lên phải qua kiểm tra ở tầng security (`src/security/uploadGuard.ts` và các guard sẵn có) — không lưu file thô chưa kiểm tra.
5. Comment tiếng Việt đơn giản ở đoạn logic trọng tâm (validate phức tạp, xử lý tiền nong, render).
6. Việc đụng tới bảng/cột database phải nêu rõ trong báo cáo để đối chiếu với ERD của hệ thống.
7. Giữ đồ thị phụ thuộc một chiều, chống import vòng: tầng route gọi xuống tầng `src/database/` và các tầng xử lý bên dưới; tầng database không import ngược lên tầng route; các module ngang cấp không import lẫn nhau thành vòng tròn. Thêm module mới thì kiểm tra lại chiều import trước khi commit.
8. Tránh lỗi N+1 query: khi cần dữ liệu của nhiều bản ghi liên quan, dùng một câu truy vấn gộp (JOIN hoặc `IN (...)`) thay vì vòng lặp truy vấn từng bản ghi một.
