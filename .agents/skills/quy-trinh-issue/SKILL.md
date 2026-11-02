---
name: "quy_trinh_issue"
description: "Skill điều phối tổng: xử lý một issue từ đầu tới cuối theo một quy trình duy nhất — làm rõ yêu cầu, phân tích ra phantich.md chờ duyệt, code từng bước nhỏ với kiểm chứng sau mỗi bước, lỗi thì debug ngay trong bước, đạt mới commit và push, cuối cùng tự review và mở PR. Tự kích hoạt các skill con (phan-tich-issue, lam-frontend, lam-backend, viet-test, debug-loi, review-code) đúng thời điểm. Dùng khi nhận một issue/task mới và cần xử lý trọn gói."
version: 1.0.0
---

# Quy trình xử lý issue (skill điều phối)

## Purpose
Biến các skill con rời rạc thành một quy trình tự chạy khi xử lý issue. Người dùng chỉ ra lệnh một lần và duyệt ở các chốt quan trọng; skill này quyết định skill con nào được gọi, vào thời điểm nào, theo thứ tự nào, và điều kiện gì mới được chuyển bước. Sơ đồ trực quan của quy trình nằm ở `references/so-do-quy-trinh.md`.

## Pipeline

### Giai đoạn 0 — Tiếp nhận và làm rõ yêu cầu
1. Đọc kỹ issue: yêu cầu là gì, tiêu chí nghiệm thu (acceptance criteria) là gì, ai giao, ai cùng làm.
2. Điểm nào chưa rõ (phạm vi, trường hợp biên, dữ liệu vào/ra) thì hỏi lại người giao trước — không tự đoán rồi làm.
3. Nếu nhiều người cùng được giao một issue hoặc phải sửa chung file: chốt phân chia phạm vi bằng comment trên issue trước khi bất kỳ ai code.

### Giai đoạn 1 — Phân tích (kích hoạt `phan-tich-issue`)
1. Áp dụng skill `phan-tich-issue`: khảo sát codebase liên quan, viết `phantich.md` gồm tóm tắt các bước nhỏ, chi tiết từng bước (file sửa/thêm/xóa + lý do), cách kiểm chứng từng bước, rủi ro/giả định.
2. **CHỐT DỪNG:** trình `phantich.md` cho người dùng duyệt. Chưa được duyệt thì không viết code, kể cả việc trông có vẻ nhỏ.
3. Issue thay đổi giữa chừng → cập nhật `phantich.md` trước, rồi mới làm tiếp.

### Giai đoạn 2 — Chuẩn bị
1. Tạo nhánh riêng cho issue từ `main` mới nhất, đặt tên theo quy ước của repo (ví dụ `feat/issue<so>-<ten-ngan>`). Mỗi issue một nhánh.
2. Commit riêng file `phantich.md` lên nhánh (Bước 0) và push.

### Giai đoạn 3 — Thực thi từng bước (vòng lặp lõi)
Với mỗi bước trong `phantich.md`, đi đúng vòng sau — không đổi thứ tự, không gộp bước:

1. **Chọn skill theo mảng việc:** bước frontend → `lam-frontend`; bước backend → `lam-backend`; bước sơ đồ/tài liệu → `uml`; các skill này là luật bắt buộc trong lãnh địa của chúng, không làm theo trí nhớ.
2. **Code đúng phạm vi bước**, thêm comment tiếng Việt đơn giản ở đoạn code được thao tác.
3. **Kiểm chứng ngay khi code xong:** có test tự động thì theo `viet-test` (viết test nếu chưa có, chạy test); không có test tự động (CSS, giao diện) thì dùng cách kiểm chứng thay thế đã ghi trong `phantich.md` cho bước đó (grep giá trị, đo số liệu, mở trình duyệt kiểm tra trực quan).
4. **Kiểm chứng không đạt → kích hoạt `debug-loi` ngay trong bước đó:** tìm nguyên nhân gốc, sửa đúng gốc, kiểm chứng lại. Lặp đến khi đạt. **Chưa đạt thì tuyệt đối không commit.**
5. **Đạt → chốt sổ:** `git add` đúng file của bước → commit riêng, message tiếng Việt mô tả đúng việc của bước → push ngay lên nhánh.
6. **Báo cáo mốc:** commit SHA, danh sách file đã chạm, cách để người dùng tự kiểm tra.

### Giai đoạn 4 — Đóng gói
1. Chạy **toàn bộ** test của dự án (không chỉ test của phần vừa sửa) để chắc chắn không làm vỡ chỗ khác.
2. Kích hoạt `review-code`: tự soi toàn bộ diff của nhánh theo checklist (bảo mật, validate, trường hợp biên, phạm vi thay đổi).
3. Mở PR vào `main`: mô tả gồm đã làm gì theo từng bước, kết quả kiểm chứng, các điểm loại trừ có chủ đích kèm lý do, link tới issue.

### Giai đoạn 5 — Sau PR
1. Có comment review: sửa theo từng ý, mỗi đợt sửa là commit riêng push tiếp lên cùng nhánh; chỗ nào chưa rõ thì hỏi lại trong PR, không cãi tay đôi.
2. PR được merge: xác nhận issue đã đóng, báo cáo tổng kết cho người dùng (các commit, PR link, phần còn tồn nếu có).

## Operating Rules
1. **Chốt duyệt là bất khả xâm phạm:** chưa duyệt `phantich.md` thì không code; nội dung đối ngoại (comment, PR) phải được người dùng duyệt trước khi đăng, trừ khi đã có ủy quyền rõ ràng từ trước.
2. **Một bước = tối đa một commit**, và commit chỉ tồn tại khi kiểm chứng của bước đã đạt.
3. **Thực tế lệch khỏi bản phân tích thì dừng và xử lý lệch trước:** ghi nhận điểm lệch, báo người dùng, cập nhật `phantich.md` rồi mới làm tiếp. Không tự bịa hướng xử lý ngoài bản phân tích đã duyệt.
4. **Mức tự chủ theo chỉ thị của người dùng:** mặc định báo cáo sau mỗi bước và chờ lệnh bước tiếp theo; khi người dùng nói làm trọn gói thì chạy liên tục qua các bước, chỉ dừng ở các chốt duyệt và khi gặp quyết định không có trong `phantich.md`.
5. **Báo cáo bằng bằng chứng, không bằng khẳng định:** mọi mốc hoàn thành đều kèm commit SHA, danh sách file, link liên quan và lệnh/cách tự kiểm tra.
6. Quy trình này áp dụng cho cả bug fix phát sinh sau này, không chỉ issue mới.
