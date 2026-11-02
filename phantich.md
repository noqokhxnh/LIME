# Phân tích Issue #129: Audit & tối ưu thiết kế workspace.html — TOÀN BỘ ISSUE

*(Issue: https://github.com/noqokhxnh/LIME/issues/129 — Tuấn làm toàn bộ issue. Bản cập nhật ngày 03/11/2026: mở rộng phạm vi từ nhóm B sang cả 3 nhóm A/B/C. Số dòng trích dẫn lấy từ `main` tại thời điểm khảo sát, file `frontend/workspace.css` — 622 dòng, `frontend/workspace.html` — 361 dòng, `frontend/workspace.js` — 2174 dòng.)*

## 1. Tóm tắt issue và phạm vi

Issue yêu cầu sửa 7 nhóm vấn đề trên trang workspace (viewport khóa cứng, thiếu `<h1>`, chữ nhỏ, lề sát, tương phản màu thấp, đổ bóng nặng, video thiếu poster), chia 3 nhóm việc:

- **Nhóm A (HTML)** — viewport, `<h1>`, poster cho video. *(Viewport được gộp vào làm cùng nhóm C vì hai việc phụ thuộc nhau — xem Bước 7.)*
- **Nhóm B (hiển thị CSS)** — cỡ chữ + giãn chữ, padding panel, màu tương phản WCAG, đổ bóng. **Đã xong 3/4 mục** (Bước 1–3), còn mục đổ bóng (Bước 4) chờ leader xác nhận.
- **Nhóm C (responsive)** — xếp dọc 3 cột khi màn hình < 1180px bằng CSS thuần (đã chốt không làm tab), làm sau cùng vì đụng lại cột/padding của các phần kia.

Quyết định đã chốt: poster làm ảnh tĩnh 16:9 riêng từ logo có sẵn của dự án; responsive xếp dọc, thứ tự ưu tiên: khung video → cột trái → cột phải.

## 2. Tóm tắt các bước

- ✅ Bước 0: Chuẩn bị — nhánh `feat/issue129-ws-typography`, comment chia việc trên issue, commit phân tích. *(commit `dca3ee0`)*
- ✅ Bước 1: Màu tương phản — đổi biến `--wdim` đạt WCAG AA. *(commit `2cc8109`)*
- ✅ Bước 2: Typography — giảm giãn chữ tiêu đề panel, nâng chữ nội dung lên tối thiểu 11px. *(commit `ceb7e67`)*
- ✅ Bước 3: Padding panel 14px → 16px. *(commit `0fe6f34`)*
- ✅ Bước 4: Đổ bóng — ĐÃ CHỐT giữ nguyên, không sửa code (xem chi tiết Bước 4).
- Bước 5: Thẻ `<h1>` cho tên dự án (nhóm A) — lồng nút bấm vào trong `<h1>`.
- Bước 6: Poster cho video (nhóm A) — tạo ảnh 16:9 + khai báo thuộc tính `poster`.
- Bước 7: Responsive khung chính (nhóm C1) — sửa viewport, bỏ khóa cứng `min-width`, xếp dọc 3 cột dưới 1180px.
- Bước 8: Responsive chi tiết (nhóm C2) — rà soát các khối con ở 390px/768px, đảm bảo không tràn ngang.
- Bước cuối: Tự review toàn bộ diff, mở PR vào main.

## 3. Chi tiết từng bước

### Bước 0: Chuẩn bị — ✅ ĐÃ XONG (`dca3ee0`)
- Tạo nhánh `feat/issue129-ws-typography` từ `main` (`5cc4d71`); đăng comment đề xuất chia việc lên issue #129 (comment `6584743949`; Tuấn đã tự sửa lại comment ngày 03/11 khi quyết định làm toàn bộ issue); commit file phân tích này.

### Bước 1: Màu tương phản WCAG AA (`--wdim`) — ✅ ĐÃ XONG (`2cc8109`)
- **Sửa:** `frontend/workspace.css` dòng 4 — `--wdim:#818978` → `#52584A` kèm comment. Đo kiểm chứng: cũ 3.31–3.63:1 (rớt AA), mới 6.7–7.36:1 (đạt AA). Grep mã cũ = 0, diff đúng 1 dòng.

### Bước 2: Typography — ✅ ĐÃ XONG (`ceb7e67`)
- **Sửa:** `frontend/workspace.css` — `.p-head`: `letter-spacing` 1.4px → 0.8px, `font-size` 11px → 12px; nâng 17 vị trí chữ nội dung 10px (9 chỗ) và 10.5px (8 chỗ) lên 11px.
- **Loại trừ giữ nguyên:** nhãn 7–9.5px đè trên thumbnail ảnh (nâng lên sẽ phá bố cục thumbnail) — nêu rõ trong PR để leader quyết riêng.
- **Lệch nhỏ đã xử lý:** khảo sát lại thấy thêm 7 vị trí 10.5px cùng loại chữ nội dung chưa liệt kê trong bản phân tích đầu — đã xử lý theo cùng nguyên tắc và báo cáo ở mốc Bước 2.

### Bước 3: Padding panel 14px → 16px — ✅ ĐÃ XONG (`0fe6f34`)
- **Sửa:** `.p-head` `padding:0 14px` → `0 16px`; `.p-body` `padding:14px` → `16px`. Đã né đúng phạm vi: `padding:0 14px` còn xuất hiện ở `.tl-tools` và `.statusbar`, `padding:14px` ở `.monitor-host` — cả 3 đều ngoài phạm vi issue, giữ nguyên.

### Bước 4: Đổ bóng — ✅ ĐÃ CHỐT (giữ nguyên, không sửa code)
- **Phát hiện:** giá trị đổ bóng nặng trong issue (`rgba(0,0,0,0.25) 0px 25px 60px -15px`) không tồn tại trong `workspace.css`/`workspace.html` trên main. Đổ bóng mạnh nhất đang có là ở `.ws-user-dropdown` (dòng 103) — menu nổi, về nguyên tắc cần đổ bóng để tách lớp.
- **Quyết định (Tuấn chốt 03/11/2026):** giữ nguyên đổ bóng hiện tại, bước này đóng mà không có commit code. Leader chưa trả lời câu hỏi trong comment trên issue — nếu sau này leader yêu cầu giảm, mở lại bước này và chỉ giảm nhẹ shadow của `.ws-user-dropdown` (ví dụ `0 4px 12px rgba(20,22,15,.08)`), commit riêng.

### Bước 5: Thẻ `<h1>` cho tên dự án (nhóm A)
- **Hiện trạng (đã khảo sát):** `frontend/workspace.html` dòng 26 — tên dự án là `<button class="proj-name" id="proj-name">`, và nó có chức năng thật: `workspace.js` lấy phần tử này để hiện tên dự án (dòng 500, 782–786) và gắn sự kiện click để tạo dự án mới (dòng 2060 `addEventListener('click', resetProject)`).
- **Vấn đề với cách làm nguyên văn trong issue:** đổi thẳng `<button>` thành `<h1>` thì JS vẫn chạy (id giữ nguyên), nhưng nút mất khả năng focus/bấm bằng phím Enter–Space — sửa lỗi trợ năng này lại sinh lỗi trợ năng khác.
- **Cách làm đã chọn:** lồng nút vào trong `<h1>`:
  - **Sửa:** `frontend/workspace.html` dòng 26 → `<h1 class="proj-title"><button type="button" class="proj-name" id="proj-name" ...>...</button></h1>` (giữ nguyên id, class, title, nội dung của nút).
  - **Sửa:** `frontend/workspace.css` — thêm rule cho `.proj-title` ngay cạnh các rule `.proj-name` (khoảng dòng 26): reset `margin:0`, `font-size:inherit`, `font-weight:inherit`, hiển thị flex để không phá bố cục topbar.
  - **Không sửa:** `frontend/workspace.js` — id/class không đổi nên không cần đụng.
- **Kiểm chứng:** DOM có đúng 1 thẻ `<h1>`; bấm vào tên dự án vẫn tạo dự án mới như trước; Tab tới được nút và Enter/Space bấm được; topbar ở 1440px không lệch hàng (so với ảnh chụp trước khi sửa).

### Bước 6: Poster cho video (nhóm A)
- **Hiện trạng:** `frontend/workspace.html` dòng 139 — `<video id="video-player" controls playsinline style="display:none"></video>`, chưa có `poster`.
- **Thêm mới:** `frontend/video-poster.png` — ảnh tĩnh 1280×720 (tỉ lệ 16:9): nền `#F3F5EF` (đúng biến `--wbg` của trang) + logo LIME có sẵn của dự án đặt giữa. Dung lượng mục tiêu < 200KB.
- **Sửa:** `frontend/workspace.html` dòng 139 — thêm `poster="video-poster.png"` (đường dẫn tương đối, cùng cách trang đang nạp `workspace.css`/`workspace.js`).
- **Kiểm chứng:** mở workspace, khi khung video hiện mà chưa có video nạp, khung hiện ảnh poster (không chớp đen); file ảnh tải được (không lỗi 404 — kiểm tra ở tab Network của trình duyệt); ảnh không méo tỉ lệ.

### Bước 7: Responsive khung chính (nhóm C1)
- **Sửa:** `frontend/workspace.html` dòng 6 — `<meta name="viewport" content="width=1440">` → `content="width=device-width, initial-scale=1.0"`. *Làm cùng bước này* vì viewport mới chỉ phát huy khi CSS responsive đi kèm; tách riêng sẽ khiến mobile tạm thời hiển thị tệ hơn hiện tại.
- **Sửa:** `frontend/workspace.css`:
  - Thêm khối `@media (max-width: 1179px)` ở cuối file:
    - `body.ws`: `min-width:0; height:auto; overflow:visible` (bỏ khóa cứng, cho trang cuộn dọc tự nhiên).
    - `.ws-main`: `grid-template-columns:1fr; grid-template-rows:none; grid-template-areas:"center" "left" "right"` (xếp dọc theo thứ tự ưu tiên đã chốt: video → cột trái → cột phải).
    - `.panel` và `.p-body`: bỏ giới hạn chiều cao cuộn nội bộ (`max-height:none; overflow:visible`) để nội dung chảy theo trang, tránh cuộn lồng cuộn.
  - Thêm comment tiếng Việt trên đầu khối media query giải thích đây là phần responsive của issue #129.
- **Kiểm chứng:** ở bề rộng 1440px giao diện **không đổi gì** (mọi thay đổi nằm trong media query + thẻ viewport); ở 768px và 390px (dùng chế độ device toolbar của trình duyệt): 3 cột đã xếp dọc đúng thứ tự, không còn thanh cuộn ngang.

### Bước 8: Responsive chi tiết (nhóm C2)
- **Sửa:** `frontend/workspace.css` — trong cùng khối media query của Bước 7, tinh chỉnh các khối con bị chật ở màn hình nhỏ (danh sách rà soát từ code hiện tại):
  - `.rb-cards` (đang `repeat(3, 1fr)`) → 1 cột ở < 768px.
  - `.topbar`: co gọn ở 390px (giảm khoảng đệm, cho phép ẩn phần tử phụ nếu tràn).
  - `.statusbar` và `.tl-tools` (thanh công cụ timeline): cho phép xuống dòng/co gọn thay vì tràn.
  - `.rb-scene` (đang cột 132px + 1fr): rà soát ở 390px, chỉ sửa nếu thực tế bị vỡ.
- **Kiểm chứng:** đo ở 390px và 768px: `document.documentElement.scrollWidth` không lớn hơn bề rộng màn hình (không tràn ngang — đúng số đo issue nêu: trước sửa tràn 412px ở 768px, ~800px ở 390px); thao tác thử: mở đủ 3 panel, cuộn hết trang không kẹt; quay lại 1440px kiểm tra lần cuối không ảnh hưởng desktop.

### Bước cuối: Review và mở PR
- Tự soi toàn bộ diff bằng checklist của skill `review-code`; chạy kiểm tra cú pháp CSS cơ bản (không lỗi ngoặc), mở trang workspace kiểm tra trực quan lần cuối ở 3 mốc 1440/768/390.
- Mở PR từ `feat/issue129-ws-typography` vào `main`: mô tả liệt kê đủ 8 mục checklist của issue — mục nào đã làm (kèm commit), mục loại trừ có chủ đích (nhãn thumbnail; đổ bóng nếu leader chốt bỏ qua) kèm lý do, số đo tương phản trước/sau, ảnh chụp trước/sau ở desktop và mobile.
- **Kiểm chứng:** PR hiện đủ danh sách commit theo từng bước, mô tả có số liệu, link về issue #129.

## 4. Rủi ro / giả định

- **Số liệu audit trong issue lệch nhẹ so với main hiện tại:** tương phản đo lại 3.63:1 trên nền trắng (issue ghi 3.1–3.3:1); tên dự án là `<button>` chứ không phải `<span>`; đổ bóng nặng không còn tồn tại. Kết luận chung vẫn đúng — khi làm bám code hiện tại, không bám số trong issue (đây là lý do Bước 4 và cách làm ở Bước 5 khác nguyên văn issue).
- **Đổi `--wdim` là thay đổi diện rộng** (1 biến, ~20 vị trí gồm cả viền hover và chấm trạng thái) — đã rà soát ở Bước 1.
- **CSS/HTML không có test tự động:** kiểm chứng bằng grep giá trị, đo số liệu (tương phản, scrollWidth) và kiểm tra trực quan trên trình duyệt ở các mốc bề rộng — đã ghi cụ thể ở từng bước.
- **Bước 7–8 là phần rủi ro cao nhất** (đụng cấu trúc layout toàn trang): mọi thay đổi responsive phải nằm gọn trong `@media (max-width: 1179px)` để desktop không bị ảnh hưởng; nếu xếp dọc làm vỡ một khối con khó, ghi nhận và tách xử lý ở Bước 8 thay vì sửa lan.
- **Ảnh poster là file nhị phân duy nhất của issue:** tạo từ logo có sẵn, không dùng ảnh ngoài; nếu leader muốn poster khác (ví dụ khung hình mẫu của video) thì chỉ cần thay file, không đổi code.
- Không cần thêm dependency nào. Ngoài 3 file `workspace.html`, `workspace.css` và file ảnh mới, không đụng file nào khác (đặc biệt không sửa `workspace.js`, `style.css`, `/css/broadcast.css`, `/css/support-widget.css`).

## 5. Comment trên issue (đã đăng — không còn là dự thảo)

Comment đề xuất chia 3 nhóm đã đăng ở Bước 0 (id `6584743949`) và được Tuấn sửa lại ngày 03/11/2026 khi quyết định làm toàn bộ issue: bỏ câu nhận riêng nhóm B, giữ đề xuất kỹ thuật (poster 16:9 riêng, responsive xếp dọc làm sau cùng) và câu hỏi xác nhận mục đổ bóng cho leader. Leader và các bạn cùng được giao chưa phản hồi tính đến thời điểm cập nhật bản phân tích này.

## 6. Ghi chú khi thực hiện

- Mỗi bước: code → kiểm chứng → add đúng file → commit riêng (message tiếng Việt) → push ngay lên nhánh `feat/issue129-ws-typography`.
- Kiểm chứng không đạt → áp dụng skill `debug-loi` tìm nguyên nhân gốc, sửa và kiểm chứng lại; chỉ commit khi đã đạt.
- Thêm comment tiếng Việt đơn giản ở từng đoạn code được thao tác.
- Khi báo hoàn thành mỗi bước: commit SHA, danh sách file đã chạm, lệnh git để tự kiểm tra.
