---
name: "debug_loi"
description: "Tìm nguyên nhân gốc và cách sửa lỗi trong dự án Node/TypeScript: đọc stack trace hoặc log test fail, khoanh vùng file và hàm gây lỗi, giải thích bằng tiếng Việt đơn giản, đề xuất cách sửa từng bước và chạy lại test kiểm chứng. Dùng khi gặp lỗi, test fail, app crash, hoặc được yêu cầu debug, tìm lỗi, sửa lỗi."
---

# Debug lỗi

## Purpose
Tìm ra nguyên nhân gốc của lỗi (không đoán mò), giải thích bằng tiếng Việt đơn giản, và đưa cách sửa từng bước có kiểm chứng bằng test.

## Workflow
1. **Thu thập bằng chứng.** Đọc toàn bộ thông báo lỗi, stack trace, log test. Chưa đọc hết thì chưa kết luận.
2. **Khoanh vùng.** Từ stack trace xác định file, dòng, hàm gây lỗi. Bỏ qua các frame trong `node_modules` trừ khi lỗi xuất phát từ thư viện (xem thêm `references/common-errors.md`).
3. **Tái hiện (nếu có thể).** Chạy lại lệnh/test gây lỗi trong môi trường của mình để xác nhận lỗi có lặp lại không.
4. **Phân tích nguyên nhân gốc.** Giải thích theo chuỗi "cái gì → tại sao": giá trị nào sai, type nào lệch, thứ tự gọi hàm nào sai, dữ liệu nào bị null/undefined.
5. **Đề xuất cách sửa.** Từng bước cụ thể: file nào, sửa gì. Nếu có nhiều cách, nêu ưu/nhược điểm ngắn gọn và gợi ý cách nên chọn.
6. **Kiểm chứng.** Sau khi sửa: chạy lại test liên quan (`npx tsx --test tests/unit/<ten-file>.test.ts`) và `tsc --noEmit` nếu có đụng chạm code. Chỉ báo "xong" khi test pass.

## Output Contract
Kết quả trả về luôn gồm 4 phần:
- **Nguyên nhân gốc:** 1–2 câu tiếng Việt đơn giản.
- **Vị trí lỗi:** file, dòng/hàm cụ thể.
- **Cách sửa:** các bước cụ thể theo thứ tự.
- **Kiểm chứng:** lệnh test đã chạy và kết quả (pass/fail, số test).

## Operating Rules
1. Đọc hết thông báo lỗi trước khi kết luận; không suy đoán từ một dòng duy nhất.
2. Giải thích bằng tiếng Việt đơn giản; thuật ngữ bắt buộc dùng thì giải thích kèm ngay.
3. Ưu tiên sửa nguyên nhân gốc, không vá triệu chứng (nếu chỉ vá tạm thời thì nói rõ).
4. Mỗi lần sửa xong phải chạy lại test kiểm chứng — không báo hoàn thành khi chưa test.
5. Thiếu thông tin (thiếu log, thiếu file) thì hỏi đúng phần còn thiếu, không tự bịa.
6. Với lỗi quen thuộc, tra nhanh bảng trong `references/common-errors.md` trước khi đào sâu.
