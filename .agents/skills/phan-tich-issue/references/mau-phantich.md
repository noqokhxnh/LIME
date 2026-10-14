# Mẫu file phantich.md

Mỗi lần phân tích issue, viết file theo đúng cấu trúc dưới đây.

## Tóm tắt các bước

- Bước 0: Chuẩn bị — tạo nhánh từ main, commit file phân tích này.
- Bước 1: ... (một câu mô tả ngắn)
- Bước 2: ...
- Bước 3: ...

## Chi tiết từng bước

### Bước 0: Chuẩn bị
- **Thêm mới:** (chưa có file code ở bước này)
- **Hành động:** tạo nhánh `feature/<ten-issue>` từ `main`; commit riêng file `phantich.md`.
- **Kiểm chứng:** `git status` sạch, nhánh mới đã push lên remote.

### Bước 1: <tên bước>
- **Sửa:** `src/duong-dan/file.ts` — thêm/sửa phần X vì Y.
- **Thêm mới:** `src/duong-dan/file-moi.ts` — mục đích Z.
- **Xóa:** `src/duong-dan/file-cu.ts` — lý do không còn dùng.
- **Kiểm chứng:** chạy `npx tsx --test tests/unit/<ten-file>.test.ts`, yêu cầu pass 100%.

### Bước 2: <tên bước>
... (lặp lại cấu trúc trên)

## Rủi ro / giả định

- Cần thêm dependency X (lý do).
- Chưa chắc chắn về Y — cần spike thử trước ở Bước 1.

## Ghi chú khi thực hiện

- Mỗi bước: code → test → add đúng file → commit riêng (message tiếng Việt) → push ngay.
- Thêm comment tiếng Việt đơn giản ở từng đoạn code được thao tác.
- Khi báo hoàn thành: commit SHA, danh sách file, lệnh git để tự kiểm tra.
