# Mẫu khung test

Khung chuẩn cho một file test mới. Ba phần trong mỗi test: chuẩn bị → hành động → kiểm tra.

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
// import { hamCanTest } from '../../src/...';

// TC-01: <hành vi đúng + kết quả mong đợi>
test('TC-01: <mô tả ngắn>', async () => {
  // 1. Chuẩn bị: dựng dữ liệu giả ngay trong test, không lấy từ ngoài
  const input = { /* dữ liệu mẫu */ };

  // 2. Hành động: gọi hàm/route cần test
  const result = await hamCanTest(input);

  // 3. Kiểm tra: assert chặt với giá trị cụ thể
  assert.equal(result.status, 200);
});

// TC-02: <trường hợp lỗi + kết quả mong đợi>
test('TC-02: <mô tả ngắn>', async () => {
  // Chuẩn bị dữ liệu sai có chủ đích (thiếu trường, sai kiểu...)
  // Hành động + kiểm tra mã lỗi/thông báo lỗi cụ thể
});
```

## Ghi chú theo loại test

- **Unit test** (`tests/unit/`): test một hàm/module riêng lẻ. Không cần DB thật — truyền dữ liệu giả trực tiếp.
- **Integration test** (`tests/integration/`): test qua API bằng `app.inject()` của Fastify (không mở cổng mạng thật). Nếu test đụng DB thật thì dùng dữ liệu có tiền tố riêng (ví dụ user test) và xóa sạch trong `after()`.

## Checklist nhanh trước khi chạy

- [ ] Mỗi TC kiểm đúng một hành vi, tên test đọc là hiểu.
- [ ] Không test nào phụ thuộc kết quả của test khác.
- [ ] Dữ liệu tạm (file, bản ghi) được dọn sau khi test xong.
- [ ] Không có lệnh gọi mạng ra ngoài.
