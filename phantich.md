# Phân tích Issue #129: Audit & tối ưu thiết kế workspace.html — PHẦN VIỆC CỦA TUẤN (nhóm hiển thị)

*(Issue: https://github.com/noqokhxnh/LIME/issues/129 — leader giao cho 4 người. File này chỉ phân tích phần việc của Tuấn theo phân chia đã chốt. Số dòng trích dẫn lấy từ `main` tại thời điểm khảo sát 03/11/2026, file `frontend/workspace.css` — 622 dòng.)*

## 1. Tóm tắt issue và phạm vi phần việc này

Issue yêu cầu sửa 7 nhóm vấn đề trên trang workspace (viewport khóa cứng, thiếu `<h1>`, chữ nhỏ, lề sát, tương phản màu thấp, đổ bóng nặng, video thiếu poster). Toàn bộ issue đã được chốt chia 3 nhóm:

- **Nhóm A (HTML)** — viewport, `<h1>`, poster cho video: *đề xuất bạn khác nhận.*
- **Nhóm B (hiển thị CSS)** — cỡ chữ + giãn chữ, padding panel, màu tương phản WCAG, đổ bóng: **TUẤN NHẬN — là nội dung file này.**
- **Nhóm C (responsive)** — xếp dọc 3 cột khi màn hình < 1180px (đã chốt hướng xếp dọc, không làm tab): *làm sau cùng vì đụng lại cột/padding của các nhóm kia.*

Ba quyết định đã chốt trước khi phân tích: (1) chia việc theo nhóm và comment đề xuất lên issue; (2) poster làm ảnh 16:9 riêng từ logo có sẵn (thuộc nhóm A, ghi lại để nhóm A bám theo); (3) responsive xếp dọc bằng CSS thuần (thuộc nhóm C).

## 2. Tóm tắt các bước

- Bước 0: Chuẩn bị — tạo nhánh từ main, đăng comment đề xuất chia việc lên issue #129, commit file phân tích này.
- Bước 1: Sửa màu tương phản — đổi biến `--wdim` đạt chuẩn WCAG AA.
- Bước 2: Sửa typography — giảm giãn chữ tiêu đề panel, nâng các cỡ chữ 10px lên 11px.
- Bước 3: Tăng padding panel từ 14px lên 16px.
- Bước 4: Xử lý mục đổ bóng — rà soát, xác nhận với leader vì số liệu trong issue không khớp code hiện tại (có thể không cần sửa code).
- Bước cuối: Tự review toàn bộ diff, mở PR vào main.

## 3. Chi tiết từng bước

### Bước 0: Chuẩn bị
- **Thêm mới:** file `phantich.md` này (đặt tại thư mục gốc của nhánh làm việc để cả nhóm thấy, hoặc thư mục docs nếu leader yêu cầu khác).
- **Hành động:**
  - Tạo nhánh `feat/issue129-ws-typography` từ `main` mới nhất.
  - Đăng comment lên issue #129 đề xuất chia việc (nội dung dự thảo ở mục 5 dưới đây) — chỉ đăng sau khi Tuấn duyệt nội dung comment.
  - Commit riêng file phân tích, push nhánh lên remote.
- **Kiểm chứng:** `git status` sạch; nhánh `feat/issue129-ws-typography` đã có trên GitHub; comment đã hiện trên issue (nếu được duyệt đăng).

### Bước 1: Màu tương phản WCAG AA (`--wdim`)
- **Sửa:** `frontend/workspace.css`, dòng 4 — đổi `--wdim:#818978` thành `--wdim:#52584A` (đúng giá trị leader gợi ý trong issue).
- **Giải thích:** `--wdim` đang dùng làm màu chữ cho khoảng 20 vị trí (nhãn phụ, gợi ý, trạng thái cảnh...) nên chỉ cần đổi 1 biến là sửa tất cả. Số đo đã kiểm chứng bằng tính toán:
  - Giá trị cũ `#818978`: 3.63:1 trên nền trắng, 3.31:1 trên nền `#F3F5EF` — dưới chuẩn AA (4.5:1), khớp kết luận FAIL của issue.
  - Giá trị mới `#52584A`: **7.36:1** trên nền trắng, **6.7:1** trên nền `#F3F5EF` — vượt AA, gần đạt AAA.
- **Lưu ý khi sửa:** biến này còn được dùng cho `border-color` khi hover (dòng 27, 39, 200), nền chấm trạng thái chờ `.scn .st.wait` (dòng 209) — đậm hơn vẫn hợp lệ, nhưng phải nhìn lại các vị trí đó sau khi đổi.
- **Kiểm chứng:** mở trang workspace, rà các nhãn chữ mờ trước đây (gợi ý dưới ô prompt, meta của cảnh, ghi chú inspector) đọc rõ hơn và không lệch tông xanh lá của giao diện; không còn chỗ nào dùng mã màu cũ (grep `#818978` = 0 kết quả).

### Bước 2: Typography — giãn chữ + cỡ chữ nhỏ
- **Sửa:** `frontend/workspace.css`:
  - Dòng 163–164 (`.p-head`): `letter-spacing:1.4px` → `0.8px` (giữ in hoa cho đồng bộ, chỉ giảm giãn để dễ đọc lướt). Cân nhắc đồng thời nâng `font-size:11px` của `.p-head` lên `12px` — ghi rõ là tùy chọn trong lúc làm, nhìn thực tế rồi quyết.
  - Các `font-size:10px` và `10.5px` thuộc chữ nội dung trong panel → nâng lên `11px`, gồm các dòng: 185 (`.prompt-assets-hint`, 10.5px), 204 (nhãn giữa khối scene), 217 (`.screen .badge`), 304 (chữ ở timeline), 325 (mốc trên timeline), 460 (`.ask-top>span` — đúng selector issue nêu), 515 (`.auto-note`), 550 (`.rb-metrics`), 569 (`.rb-scene-head span`), 579 (`.rb-assets-hint`).
- **Loại trừ có chủ đích (không sửa ở bước này):** các nhãn 7–9.5px đè trực tiếp trên thumbnail ảnh (dòng 497 `.ask-chip>span` 9px, 547 `.rb-badge` 9px, 591 nhãn 7px, 601 `.rb-scene-assets-label` 9.5px). Đây là nhãn trang trí trên ảnh, không phải chữ nội dung; nâng lên 11px sẽ phá bố cục thumbnail. Ghi vào PR để leader quyết riêng.
- **Kiểm chứng:** grep `font-size:10px` trong file chỉ còn lại nếu có chủ đích (mặc định phải = 0); mở trang xem các panel: tiêu đề dễ đọc hơn, các hàng chữ nâng cỡ không tràn/ngắt dòng vỡ layout ở chiều rộng desktop 1440px.

### Bước 3: Padding panel 14px → 16px
- **Sửa:** `frontend/workspace.css`:
  - Dòng 163 (`.p-head`): `padding:0 14px` → `padding:0 16px`.
  - Dòng 165 (`.p-body`): `padding:14px` → `padding:16px`.
- **Giải thích:** đúng yêu cầu issue — chữ trong panel cách mép tối thiểu 16px thay vì 14px như hiện tại.
- **Kiểm chứng:** đo lại trên trình duyệt: khoảng cách từ mép trái panel tới chữ ≥ 16px; 3 cột không bị tràn ngang (mỗi panel phần nội dung hẹp đi 4px, tổng chiều rộng trang không đổi vì `min-width` của `body.ws` giữ nguyên — rủi ro thấp nhưng vẫn phải nhìn thực tế, đặc biệt cột trái nhiều chữ).

### Bước 4: Đổ bóng — rà soát và xác nhận (có thể không sửa code)
- **Phát hiện khi khảo sát:** giá trị đổ bóng nặng trong issue (`rgba(0,0,0,0.25) 0px 25px 60px -15px`) **không tồn tại** trong `frontend/workspace.css` lẫn `frontend/workspace.html` trên main hiện tại. Đổ bóng mạnh nhất đang có là ở `.ws-user-dropdown` (dòng 103: `0 10px 25px -5px rgba(20,22,15,0.12), 0 8px 10px -6px rgba(20,22,15,0.06)`) — đó là **menu nổi** thả xuống khi bấm vào avatar, không phải panel tĩnh; menu nổi cần đổ bóng để tách lớp khỏi nền nên về nguyên tắc nên giữ.
- **Hành động đề xuất:** báo lại phát hiện này cho leader ngay trong comment ở Bước 0 (hỏi xác nhận: audit đo trên bản code nào / có phải đã được ai sửa trước không). Nếu leader vẫn muốn giảm: chỉ giảm nhẹ shadow của `.ws-user-dropdown` xuống mức phẳng hơn (ví dụ `0 4px 12px rgba(20,22,15,.08)`), commit riêng như các bước khác. Nếu leader xác nhận bỏ qua: bước này đóng bằng comment, không có commit code.
- **Kiểm chứng:** có phản hồi xác nhận của leader trên issue; nếu có sửa thì mở thử dropdown kiểm tra vẫn phân biệt rõ với nền.

### Bước cuối: Review và mở PR
- **Hành động:**
  - Tự soi lại toàn bộ diff bằng checklist của skill `review-code` (đúng phạm vi chưa, có sửa lan sang phần của nhóm A/C không).
  - Mở PR từ `feat/issue129-ws-typography` vào `main`: mô tả PR liệt kê 4 mục đã làm kèm số đo tương phản trước/sau, nêu rõ 2 điểm loại trừ (nhãn trên thumbnail; đổ bóng) và lý do, đính kèm ảnh chụp workspace trước/sau khi sửa.
- **Kiểm chứng:** PR hiện đủ: danh sách commit theo từng bước, mô tả có số liệu, link về issue #129.

## 4. Rủi ro / giả định

- **Số liệu audit trong issue lệch nhẹ so với main hiện tại:** tương phản đo lại là 3.63:1 trên nền trắng (issue ghi 3.1–3.3:1); thẻ tên dự án thực tế là `<button class="proj-name">` chứ không phải `<span>` như issue viết; đổ bóng nặng không còn tồn tại. Kết luận chung của issue vẫn đúng, nhưng khi làm phải bám code hiện tại, không bám số trong issue. Đây cũng là lý do Bước 4 tồn tại.
- **Đổi `--wdim` là thay đổi diện rộng:** 1 biến nhưng ~20 vị trí hiển thị đổi theo, gồm cả viền hover và chấm trạng thái — bắt buộc rà soát trực quan toàn trang sau Bước 1.
- **CSS không có test tự động:** kiểm chứng của các bước là grep giá trị + mở trang kiểm tra trực quan ở bề rộng 1440px (phạm vi desktop hiện tại). Responsive thuộc nhóm C, không kiểm chứng ở bản này.
- **Thứ tự làm việc giữa các nhóm:** nhóm B sửa chung file `workspace.css` với nhóm C — nhóm C làm sau cùng như đã chốt để tránh xung đột; nếu bạn khác sửa cùng file song song, phải thống nhất lại thứ tự trước khi bắt đầu.
- Không cần thêm dependency nào. Không đụng `style.css`, `/css/broadcast.css`, `/css/support-widget.css` (các file CSS khác trang có nạp) vì issue chỉ nêu `workspace.html` + `workspace.css`.

## 5. Dự thảo comment chia việc trên issue #129 (đăng ở Bước 0, sau khi Tuấn duyệt)

> Em đề xuất chia checklist của issue này thành 3 nhóm để tránh giẫm chân nhau trên cùng file `workspace.css`:
> - Nhóm A (HTML): sửa viewport, đổi tên dự án sang thẻ `<h1>`, thêm poster cho video — poster em đề xuất làm 1 ảnh tĩnh 16:9 riêng từ logo có sẵn của dự án thay vì trỏ thẳng vào logo (tránh bị kéo giãn).
> - Nhóm B (hiển thị CSS): cỡ chữ + giãn chữ, padding panel, màu `--wdim` theo WCAG AA, đổ bóng — **em nhận nhóm này**.
> - Nhóm C (responsive < 1180px): em đề xuất hướng xếp dọc 3 cột bằng CSS thuần (không làm tab để khỏi đụng thêm JS), và nên làm sau cùng vì sẽ đụng lại cột/padding của 2 nhóm kia.
>
> Một lưu ý nhỏ: em rà trên main hiện tại chưa thấy giá trị box-shadow nặng như trong bản audit (`0px 25px 60px -15px`) — đổ bóng mạnh nhất đang có là ở menu dropdown của avatar. Anh xác nhận giúp em mục này còn cần sửa không, hay bản audit đo trên code cũ ạ.

## 6. Ghi chú khi thực hiện

- Mỗi bước: code → kiểm chứng → add đúng file → commit riêng (message tiếng Việt) → push ngay lên nhánh `feat/issue129-ws-typography`.
- Thêm comment tiếng Việt đơn giản ở từng đoạn CSS được thao tác (ví dụ trên dòng `--wdim` ghi rõ mã màu này đạt tương phản bao nhiêu).
- Khi báo hoàn thành mỗi bước: commit SHA, danh sách file đã chạm, lệnh git để tự kiểm tra.
