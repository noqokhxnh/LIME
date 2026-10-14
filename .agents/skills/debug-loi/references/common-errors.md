# Các lỗi thường gặp (Node/TypeScript)

Tra nhanh trước khi đào sâu. Cột "kiểm tra đầu tiên" là việc nên làm ngay.

| Thông báo lỗi | Nguyên nhân hay gặp | Kiểm tra đầu tiên |
|---|---|---|
| `Cannot read properties of undefined (reading '...')` | Truy cập thuộc tính của giá trị `undefined`/`null` (dữ liệu API/DB thiếu, quên `await`) | In giá trị biến ngay trước dòng lỗi; kiểm tra có `await` chưa |
| `ENOENT: no such file or directory` | Sai đường dẫn, file chưa được tạo, hoặc `process.cwd()` khác lúc chạy | In `process.cwd()` và đường dẫn tuyệt đối ra kiểm tra |
| `EADDRINUSE: address already in use :::3000` | Port đã có tiến trình khác chiếm | Tìm tiến trình cũ và tắt, hoặc đổi port |
| `SyntaxError: Cannot use import statement outside a module` | Lẫn lộn ESM/CJS (`package.json` thiếu `"type": "module"` hoặc import sai kiểu) | Kiểm tra `"type"` trong package.json và cách import của lib |
| `ZodError` / `validation failed` | Dữ liệu vào không đúng schema (thiếu trường, sai type) | In `error.flatten()` hoặc issues của zod để thấy trường nào sai |
| `relation "..." does not exist` (pg) | Chưa chạy migration / sai tên bảng | Kiểm tra database đã migrate chưa, tên bảng có đúng không |
| `null value in column ... violates not-null` (pg) | Truyền `undefined`/`null` vào cột NOT NULL | Kiểm tra giá trị trước khi insert, dùng `?? null` đúng chỗ |
| `ECONNREFUSED` | Service phụ (DB, Redis, API) chưa chạy hoặc sai host/port | Thử kết nối thủ công tới host/port đó |
| `Out of memory` / heap | Đọc file lớn vào RAM một lúc, vòng lặp vô hạn | Đọc file theo stream/chunk, kiểm tra điều kiện dừng vòng lặp |
| Test timeout | `await` bị treo (promise không resolve), server test chưa đóng | Kiểm tra `after()` có dọn dẹp không, promise nào chưa resolve |
| `TS2339: Property '...' does not exist` | Sai tên thuộc tính hoặc type chưa cập nhật | Kiểm tra interface/type định nghĩa, chạy `tsc --noEmit` xem hết lỗi |
