---
name: "viet_test"
description: "Viết test theo chuẩn dự án LIME: dùng node:test + assert/strict, đặt tên case TC-..., fixture tự dựng trong test, không phụ thuộc mạng, chạy bằng tsx --test và yêu cầu pass 100% trước khi commit. Dùng khi cần viết unit test hoặc integration test cho code mới/sửa, hoặc khi một bước trong phantich.md yêu cầu có test."
version: 1.1.0
---

# Viết test

## Purpose
Viết test đúng một chuẩn duy nhất cho dự án: nhất quán cách đặt tên, độc lập giữa các test, và đủ chặt để bắt được lỗi thật — để mỗi bước code xong là có test kiểm chứng ngay trước khi commit.

## Workflow
1. **Xác định phạm vi.** Test cho hàm/route nào, hành vi nào cần kiểm chứng. Nguồn yêu cầu: issue hoặc bước tương ứng trong `phantich.md`. Nếu yêu cầu có viết dạng kịch bản Gherkin (Given – When – Then, từ PRD hoặc issue) thì mỗi kịch bản ứng với ít nhất một TC: Given là dữ liệu chuẩn bị, When là hành động gọi, Then là kết quả đem kiểm tra (assert).
2. **Liệt kê case trước khi viết.** Ba nhóm: trường hợp đúng (happy path), trường hợp biên (giá trị rỗng, tối đa, ký tự đặc biệt), trường hợp lỗi (input sai, thiếu quyền đăng nhập, file không tồn tại). Đánh số `TC-01`, `TC-02`, ... theo thứ tự.
3. **Viết test** (xem khung mẫu trong `references/mau-test.md`):
   - Dùng `node:test` + `node:assert/strict`.
   - Mỗi test gồm 3 phần: chuẩn bị dữ liệu giả → gọi code cần test → kiểm tra kết quả.
   - Với API: dùng `app.inject()` của Fastify thay vì mở cổng mạng thật.
4. **Chạy kiểm chứng.** `npx tsx --test tests/unit/<ten-file>.test.ts` (hoặc thư mục `tests/integration/` với test API). Yêu cầu pass 100% mới được commit. Test fail thì chuyển sang quy trình của skill `debug-loi`. Khi cần đo độ bao phủ mã nguồn, chạy kèm cờ coverage của Node (`--experimental-test-coverage`) và ghi tỉ lệ phần trăm vào báo cáo kết quả.
5. **Tự soi test.** Tự hỏi: nếu code bị sửa sai, test này có đỏ không? Nếu không, test đang quá lỏng — viết lại assert cho chặt.

## Output Contract
Kết quả trả về gồm:
- **File test** đã tạo/cập nhật (đường dẫn đầy đủ).
- **Danh sách TC** đã bao phủ: mỗi TC một dòng mô tả hành vi.
- **Kết quả chạy:** lệnh đã chạy, số test pass/fail.

## Operating Rules
1. Test phải độc lập: không phụ thuộc thứ tự chạy, không dùng chung trạng thái với test khác; tạo dữ liệu riêng (thư mục tạm, bản ghi giả) và dọn dẹp sau khi test xong.
2. Không gọi mạng hay API thật ra ngoài — dùng fixture dựng tại chỗ hoặc mock.
3. Mỗi test chỉ kiểm một hành vi chính; tên test ghi rõ hành vi và kết quả mong đợi, ví dụ: `TC-03: trả 400 khi thiếu trường name`.
4. Ưu tiên assert chặt (`equal`, `deepEqual` với giá trị cụ thể) thay vì assert lỏng (`ok` chung chung).
5. Comment tiếng Việt đơn giản ở các đoạn chuẩn bị dữ liệu phức tạp, giải thích vì sao dựng dữ liệu như vậy.
6. Không báo hoàn thành khi test chưa chạy hoặc chưa pass 100%.
7. Phạm vi: skill này bao phủ unit test và integration test — tầng kiểm thử hiện có của repo. Kiểm thử E2E bằng trình duyệt (Playwright/Cypress) chưa được thiết lập trong repo; khi dự án bổ sung tầng đó thì tách thành quy trình riêng, không gộp vào đây.
