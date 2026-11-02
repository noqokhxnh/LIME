---
name: "phan_tich_issue"
description: "Phân tích issue kỹ thuật theo quy trình chuẩn: đọc issue và khảo sát codebase, viết file phantich.md (tóm tắt các bước nhỏ, chi tiết từng bước nêu rõ file nào sửa/thêm/xóa và giải thích), chờ duyệt trước khi code. Dùng khi nhận issue mới, task kỹ thuật, hoặc được yêu cầu phân tích trước khi làm."
version: 1.0.0
---

# Phân tích issue

## Purpose
Biến một issue/task thành bản kế hoạch thực hiện chi tiết trong file `phantich.md`: chia nhỏ thành các bước, mỗi bước nêu rõ file nào sửa/thêm/xóa và vì sao — để người dùng duyệt trước khi viết bất kỳ dòng code nào.

## Workflow
1. **Đọc kỹ issue.** Yêu cầu là gì, tiêu chí hoàn thành (acceptance criteria) là gì, có test nào bắt buộc pass không. Nếu issue mơ hồ, hỏi lại trước khi phân tích.
2. **Khảo sát codebase.** Tìm các file/module liên quan (route, service, test hiện có, docs). Ghi lại cái gì đã có, cái gì còn thiếu, code hiện tại làm việc ra sao.
3. **Đánh giá rủi ro.** Có cần thêm dependency mới không? Có chỗ nào chưa chắc chắn cần thử nghiệm (spike) trước không? Ghi rõ giả định.
4. **Chia thành các bước nhỏ.** Mỗi bước là một đơn vị độc lập: làm xong là có thể test và commit riêng. Bước 0 thường là chuẩn bị (tạo nhánh từ main, commit file phân tích).
5. **Viết file `phantich.md`** gồm 2 phần (xem mẫu trong `references/mau-phantich.md`):
   - Tóm tắt các bước công việc nhỏ (danh sách ngắn, theo thứ tự).
   - Chi tiết từng bước: với mỗi bước liệt kê file sửa (sửa gì, vì sao), file thêm mới (mục đích), file xóa (lý do).
6. **Trình để duyệt.** Chỉ bắt đầu Bước 1 sau khi người dùng duyệt `phantich.md`. Nếu issue thay đổi giữa chừng, cập nhật file phân tích trước.

## Output Contract
File `phantich.md` phải có:
- **Tóm tắt:** danh sách các bước nhỏ theo thứ tự thực hiện.
- **Chi tiết từng bước:** mỗi bước nêu rõ file nào sửa/thêm/xóa; bên cạnh mỗi file giải thích hành động và mục đích.
- **Cách kiểm chứng mỗi bước:** chạy test nào, kiểm tra điều gì.
- **Ghi chú rủi ro/giả định** nếu có (ví dụ: cần thêm thư viện X, chưa chắc API Y hoạt động).

## Operating Rules
1. Luôn viết `phantich.md` trước — không code khi chưa phân tích xong và chưa được duyệt.
2. Mỗi bước phải đủ nhỏ để hoàn thành trong một lần: code xong → chạy test → add đúng file → commit riêng → push ngay. Không gộp nhiều bước vào một commit.
3. Trong mỗi file được thao tác, thêm comment tiếng Việt đơn giản, dễ hiểu ở từng đoạn code, giải thích phần trọng tâm.
4. Commit message bằng tiếng Việt dễ hiểu, mô tả đúng bước vừa làm. Luôn push lên đúng nhánh của người dùng.
5. Quy trình này áp dụng cho cả bug fix về sau, không chỉ issue mới.
6. Khi báo hoàn thành mỗi bước: đưa commit SHA, danh sách file đã chạm tới, link PR liên quan (nếu có), và lệnh git cụ thể để người dùng tự kiểm tra.
7. Không claim người dùng có thể xem thao tác trực tiếp — cách làm việc là push lên nhánh, người dùng pull về chạy thử và đánh giá.
