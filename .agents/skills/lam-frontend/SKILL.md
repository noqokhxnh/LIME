---
name: "lam_frontend"
description: "Làm và sửa giao diện frontend của dự án LIME trong thư mục frontend/ (HTML, CSS, JavaScript thuần, không framework): sửa cấu trúc trang, style, và logic gọi API bằng fetch. Dùng khi issue/bước trong phantich.md đụng tới phần giao diện người dùng."
version: 1.1.0
---

# Làm frontend

## Purpose
Thực hiện các việc thuộc phần giao diện của LIME đúng cấu trúc sẵn có của dự án — HTML/CSS/JS thuần trong `frontend/`, không framework, không build step — để giao diện sửa xong khớp với phần còn lại của hệ thống và gọi đúng API backend đang có.

## Workflow
1. **Xác định đúng chỗ sửa.** Trang/thành phần nào: cấu trúc nằm trong `frontend/index.html` (và các trang tĩnh server phục vụ), logic nằm trong `frontend/app.js`, giao diện nằm trong `frontend/style.css` (và các file css đi kèm). Đọc phần hiện tại trước khi sửa.
2. **Sửa theo thứ tự: HTML → CSS → JS.** Cấu trúc trước, diện mạo sau, hành vi cuối cùng. Bám class và mẫu style sẵn có trong `style.css`, không tự chế hệ thống style mới.
3. **Gọi API bằng `fetch`.** Dùng mẫu sẵn có trong `app.js`: `fetch(\`${API_BASE}/api/...\`, { credentials: 'include' })` để kèm cookie phiên đăng nhập. Trước khi gọi, đối chiếu đường dẫn và dữ liệu với hợp đồng API trong `docs/api.md` (tài liệu hợp đồng của dự án, tương đương vai trò của Swagger/OpenAPI). Chỉ gọi endpoint backend thật sự tồn tại — endpoint chưa có thì ghi rõ "cần backend bổ sung" trong báo cáo, không tự bịa đường dẫn.
4. **Xử lý đủ trạng thái.** Mọi thao tác gọi API phải có đủ 4 trạng thái: đang tải (Loading), báo lỗi kèm hướng xử lý khi API trả lỗi (Error), hiển thị kết quả khi thành công (Success), và khi thành công nhưng không có dữ liệu thì hiện thông báo rỗng thân thiện thay vì khoảng trắng (Empty state). Người dùng không bao giờ bấm nút mà không thấy phản hồi gì.
5. **Kiểm chứng trên trình duyệt.** Mở trang, tự tay thao tác đúng luồng người dùng (bấm nút, gửi form, tải file), mở Console xem có lỗi đỏ không. Đối chiếu hiển thị với yêu cầu trong issue/phantich.md.

## Output Contract
Kết quả trả về gồm:
- **File đã sửa:** đường dẫn + tóm tắt thay đổi từng file.
- **Thao tác đã thử:** các bước đã tự kiểm tra trên trình duyệt và kết quả.
- **Việc còn treo (nếu có):** endpoint backend còn thiếu hoặc phần chưa kiểm chứng được.

## Operating Rules
1. Không đưa framework hay thư viện build mới vào frontend — dự án đang dùng JS thuần có chủ đích.
2. Văn bản hiển thị cho người dùng viết bằng tiếng Việt, đúng giọng văn sẵn có trên giao diện.
3. Không sửa file backend trong cùng một bước frontend, trừ khi `phantich.md` ghi rõ bước đó gồm cả hai.
4. Giữ nguyên các class/id mà `app.js` đang dùng để gắn sự kiện — đổi tên bừa sẽ làm gãy logic mà không báo lỗi rõ ràng.
5. Comment tiếng Việt đơn giản ở đoạn JS khó (xử lý bất đồng bộ, cập nhật DOM nhiều bước).
