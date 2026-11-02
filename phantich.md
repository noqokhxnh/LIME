# Phân tích Issue #130 — Audit & tối ưu thiết kế storefront index.html

- Issue: https://github.com/noqokhxnh/LIME/issues/130 — "[Frontend/UI] Audit & tối ưu thiết kế storefront index.html (visual hierarchy, typography, WCAG AA, responsive)"
- Người giao: noqokhxnh (leader). Được giao cho 4 người; **tunasisme nhận toàn bộ issue** (quyết định ngày 2026-11-03).
- Nhánh làm việc đề xuất: `feat/issue130-storefront-audit` (tách từ `main` mới nhất).
- File trong phạm vi: `frontend/index.html` (1077 dòng), `frontend/style.css` (5363 dòng). Có thể đụng thêm `frontend/vietqr.css` ở Bước 2 nếu cần — sẽ báo trước khi đụng. **Không sửa file JS** (app.js, vietqr-modal.js chỉ đọc để hiểu, không sửa).
- Nguyên tắc chung: làm từng bước, mỗi bước 1 commit riêng (message tiếng Việt dễ hiểu), kiểm chứng đạt mới commit + push; comment tiếng Việt ở đoạn code được thao tác; kiểm chứng không đạt thì áp dụng skill `debug-loi` ngay trong bước.

---

## 1. Tóm tắt các bước

- **Bước 0:** Tạo nhánh, commit file phân tích này, đăng comment nhận toàn bộ issue + nêu các điểm chờ leader (câu chữ hero, asset ảnh/video thật).
- **Bước 1:** Sửa tương phản màu: tính năng bị khóa trong bảng giá + chữ xanh lá trên nền sáng.
- **Bước 2:** Sửa thẻ VietQR để `src=""` gây broken image.
- **Bước 3:** Typography đợt 1: nâng cỡ chữ nội dung chính (body 14px → 16px).
- **Bước 4:** Typography đợt 2: chuẩn hóa các cỡ chữ nhỏ li ti về thang cỡ đã chốt.
- **Bước 5:** Mobile: lề biên section tối thiểu 16px + sửa chữ "02:14" bị cắt đỉnh.
- **Bước 6:** Hero: rút gọn tiêu đề còn tối đa 2 dòng + tăng điểm nhấn (khung video lớn hơn trong màn hình đầu).
- **Bước 7:** Sửa lỗi văn bản bị che khuất (z-index/bố cục ở 3 vị trí audit nêu).
- **Bước 8:** Giản lược nhãn pill/eyebrow thừa + thay ký tự trang trí bằng cách hiển thị thống nhất.
- **Bước 9:** Làm phẳng đổ bóng nặng trên phần tử tĩnh + bỏ hiệu ứng shimmer ở nút CTA.
- **Bước 10 (chờ asset):** Bổ sung preview ảnh/video mẫu thật do LIME tạo — chỉ làm khi có file thật; chưa có thì ghi nhận và xin leader xác nhận hoãn.
- **Bước cuối:** Rà soát tổng (đếm lại cỡ font, đo lại tương phản), tự review bằng `review-code`, mở PR đối chiếu đủ 9 mục checklist.

Thứ tự có chủ đích: việc đo đếm được và ít rủi ro làm trước (màu, ảnh hỏng, typography), việc bố cục/nội dung làm sau.

---

## 2. Kết quả khảo sát code thật (đối chiếu với bản audit trong issue)

### Điểm audit nói ĐÚNG (đã kiểm chứng trên main)
- Màu tính năng bị khóa: `.feats li.off { color: #B9BCB2 }` (style.css dòng 3695) — đo lại = **1.93:1** trên nền trắng, khớp audit (1.9:1). Đây là các dòng `<li class="off">` như "Chèn watermark riêng vào video" (index.html dòng 319–320).
- Màu kicker/eyebrow: `.eyebrow { color: var(--lime-deep) }` với `--lime-deep: #8FBE0A` — đo trên nền kem `#FBFAF6` = **2.11:1**, khớp audit (2.1:1).
- Thẻ VietQR: index.html dòng 838 đúng là `<img id="vietqr-img" src="">`. JS `vietqr-modal.js` chỉ gán `src` khi mở modal thanh toán (dòng 91, 95, 319) nên lúc tải trang lần đầu trình duyệt vẫn request `src=""` gây broken image như audit nói.
- Hero: `.hero h1 { font-size: clamp(40px, 4.4vw, 66px) }` — khớp số audit nêu (4.4vw). Toàn trang chỉ có **2 thẻ `<img>`** (1 cái là ảnh QR hỏng) + **1 thẻ `<video>`** (video hero) — khớp nhận định "chỉ 1 hình/video thật".
- Typography: đếm trong style.css có **35 cỡ font px khác nhau** (audit đếm 23 cỡ khi render — phần chênh là các cỡ chỉ dùng ở trạng thái ít gặp). Cỡ nhỏ rất nhiều: 11px ×29 chỗ, 10px ×14, 9.5px ×8, 8.5px ×3, 8px ×1...
- Đổ bóng: 51 khai báo `box-shadow` trong style.css; hiệu ứng `shimmer-btn`/`shimmer-glow` có thật (dòng 2562 trở đi) và đang gắn cho nút CTA "Tạo video" trong hero.

### Điểm audit nói CHƯA CHÍNH XÁC / cần hiểu đúng trước khi làm
- **Tiêu đề hero không phải câu tĩnh 11 từ.** HTML dòng 71: tiêu đề gồm 3 dòng cố định bằng `<br>` — "Chữ thành phim." / "Ý tưởng thành" / một **từ xoay tự động** (flip-words, bắt đầu là "chuyển động"). Hai câu khác nhau mà audit trích ("...thành thước phim hình ảnh", "...thành chuyển động") là do từ xoay thay đổi. Phần diễn giải dài đã nằm sẵn ở đoạn `.sub` ngay dưới. → Cách sửa khác với "viết lại câu": xem Quyết định 1 ở mục 4.
- **Trang đã có sẵn responsive**: style.css có sẵn các media query 1080/1024/1100/640px. Lỗi lề mobile nằm ở từng section cụ thể chưa được rà soát ở bề ngang nhỏ, không phải thiếu responsive toàn cục.
- **Có HAI hệ design token chồng nhau** trong style.css: hệ cũ ở dòng 2–34 (`--neutral-*`, `--lime-100..950`) và hệ mới ở dòng 2107 trở đi (`--paper`, `--ink`, `--muted`, `--lime-deep`...). Đây là nguyên nhân gốc của sự hỗn loạn màu + typography — các bước dưới đây sửa theo hệ mới (hệ đang được dùng cho phần trang chính), không đụng hệ cũ ngoài phạm vi từng bước.
- `--lime-deep` được dùng **14 chỗ**, lẫn cả làm màu chữ (color) và màu nền nút/badge (background). Đậm hóa biến này toàn cục sẽ đổi cả màu nền nút — phạm vi lớn hơn ý của audit. → Cách sửa an toàn ở Bước 1: thêm biến màu chữ riêng.

---

## 3. Chi tiết từng bước

### Bước 0 — Chuẩn bị
- Tạo nhánh `feat/issue130-storefront-audit` từ `main`, commit file `phantich.md` này.
- Đăng comment trên issue: nhận toàn bộ 9 mục; báo trước 2 điểm cần leader xác nhận (câu chữ hero nếu đổi khác phương án đề xuất; asset ảnh/video thật cho mục cuối) — nội dung comment trình user duyệt trước khi đăng.
- Kiểm chứng: nhánh tồn tại, comment đã đăng (kèm link).

### Bước 1 — Tương phản màu (checklist mục 1)
- File sửa: `frontend/style.css`.
  - `.feats li.off`: `color: #B9BCB2` → `color: var(--muted)` (`--muted: #6E7268`, đo = **4.92:1** trên nền trắng, đạt AA; vẫn đủ nhạt để phân biệt "tính năng bị khóa" với tính năng thường, và dùng đúng token sẵn có của hệ mới).
  - Thêm biến `--lime-text: #557C04` vào khối biến hệ mới (đo = **4.71:1** trên nền kem, ~4.9:1 trên nền trắng). Thay `color: var(--lime-deep)` → `color: var(--lime-text)` tại các dòng đang là màu chữ trên nền sáng: 2207, 2308, 2775, 3559, 3746 và rule `.eyebrow`. Các chỗ `background: var(--lime-deep)` (nút, badge) **giữ nguyên**.
  - Khi thực thi sẽ rà soát lại từng dòng `color: var(--lime-deep)` một lần nữa: chỉ thay chỗ nào là chữ trên nền sáng; chỗ nào là chữ trên nền tối thì giữ nguyên và ghi lại lý do.
- Kiểm chứng: tính lại tỉ lệ tương phản bằng công thức WCAG cho từng cặp màu đã đổi (đều ≥ 4.5:1); grep xác nhận `#B9BCB2` không còn ở rule `.feats li.off`.
- Commit: "tăng tương phản màu chữ bảng giá và nhãn xanh đạt chuẩn WCAG AA (issue #130)".

### Bước 2 — Thẻ VietQR `src=""` (checklist mục 3, phần ảnh)
- File sửa: `frontend/index.html` (dòng 838).
  - Bỏ thuộc tính `src=""` khỏi thẻ `<img id="vietqr-img">` (giữ nguyên id, class, alt). Thẻ img không có src thì trình duyệt không phát request rác và không hiện icon ảnh hỏng; `vietqr-modal.js` vẫn gán src bình thường khi mở modal (đã kiểm chứng JS gán ở 3 điểm, không điểm nào phụ thuộc src ban đầu).
  - Nếu kiểm tra thấy khung chứa ảnh hiện viền/khung trống khó coi khi chưa có src, mới xin đụng thêm `frontend/vietqr.css` (ẩn img khi chưa có src bằng selector `img:not([src])`) — báo user trước khi mở rộng file.
- Kiểm chứng: grep thẻ img đã hết `src=""`; đọc lại đoạn JS gán src để chắc chắn không vỡ luồng thanh toán; đối chiếu: không còn thẻ img nào khác có src rỗng trong index.html.
- Commit: "bỏ src rỗng ở thẻ ảnh VietQR để hết lỗi broken image (issue #130)".

### Bước 3 — Typography đợt 1: cỡ chữ nội dung chính (checklist mục 6, phần body)
- File sửa: `frontend/style.css`.
  - Mục tiêu: chữ nội dung chạy (đoạn văn, mô tả, danh sách tính năng) từ 13.5–14px lên **16px** theo thang chốt ở Quyết định 3. Danh sách rule cụ thể sẽ liệt kê bằng census font-size ngay khi thực thi (các rule nội dung đã thấy: `.feats li` 13.5px, mô tả trong #pricing 14px, `.sub` của hero...), chỉ nâng rule nào là chữ nội dung — không nâng nhãn/nút/số liệu.
  - Mỗi rule nâng cỡ phải kiểm tra line-height đi kèm để tránh vỡ dòng/cắt chữ.
- Kiểm chứng: grep census font-size trước/sau, đối chiếu danh sách rule đã đổi; không rule nào ngoài danh sách bị thay đổi (diff đúng phạm vi).
- Commit: "nâng cỡ chữ nội dung chính lên 16px theo thang typography (issue #130)".

### Bước 4 — Typography đợt 2: chuẩn hóa cỡ nhỏ (checklist mục 6, phần scale)
- File sửa: `frontend/style.css`.
  - Áp bảng ánh xạ ở Quyết định 3 cho các cỡ < 13px và các cỡ lẻ (12.5, 13.5, 14.5, 16.5...) còn lại: chữ nội dung → về cấp Small 13–14px; nhãn chức năng/trang trí trong các khung mockup (terminal, browser giả lập) → sàn **11px**, không ép lên 13px để tránh phá bố cục khung giả lập (đây là điểm loại trừ có chủ đích, ghi rõ trong PR — tương tự tiền lệ nhãn thumbnail ở issue #129).
  - Thực thi theo từng nhóm rule cùng tính chất, đếm lại census sau mỗi nhóm.
- Kiểm chứng: census cuối bước: số cỡ font khác nhau giảm rõ rệt (mục tiêu còn ~7–8 cỡ gồm cả cấp hiển thị lớn), không còn cỡ < 11px, diff đúng phạm vi.
- Commit: "chuẩn hóa thang cỡ chữ, loại bỏ các cỡ nhỏ li ti (issue #130)".

### Bước 5 — Mobile: lề biên + chữ bị cắt (checklist mục 5)
- File sửa: `frontend/style.css`.
  - Rà soát padding ngang của các section chính (khối chứa tiêu đề "Gói dịch vụ cho mọi quy mô" ở #pricing và các section tương tự) trong các media query sẵn có (≤640px): đảm bảo lề trái/phải ≥ 16px ở 390px.
  - `.tplp-term-clock` ("02:14", index.html dòng 153): bản thân rule không đặt line-height; kiểm tra rule của khung cha (chiều cao cố định/overflow) và sửa đúng gốc — nới chiều cao dòng/padding cho khung chứa, không cắt xén chữ.
- Kiểm chứng: đọc lại toàn bộ media query ≤640px sau sửa; tính tay bề rộng nội dung ở 390px cho section đã sửa (390 − 2×lề ≥ vùng chữ an toàn); kiểm chứng trực quan cuối đợt do user/leader hỗ trợ (mở trang ở 390px).
- Commit: "sửa lề biên mobile tối thiểu 16px và lỗi cắt chữ đồng hồ mẫu (issue #130)".

### Bước 6 — Hero: tiêu đề 2 dòng + điểm nhấn (checklist mục 2)
- File sửa: `frontend/index.html` (dòng 71), `frontend/style.css` (rule `.hero h1`, khung `.showcase`/`.shot-main`).
  - Thực hiện theo phương án được chốt ở Quyết định 1. Nếu là phương án A (gộp 2 dòng): bỏ `<br>` thứ hai để "Ý tưởng thành" + từ xoay nằm cùng một dòng; đồng thời chỉnh `clamp()` ở mobile (media query sẵn có ở dòng 4010 đã override `.hero h1`) để dòng gộp không tự gãy thêm ở 390px. Không đổi từ ngữ gốc, không đụng cơ chế xoay chữ (JS không sửa).
  - Tăng điểm nhấn: nới kích thước khung video hero (`.showcase`) trong màn hình đầu tiên — tăng tỉ lệ bề ngang/chiều cao của khung chứa video so với hiện tại, giữ nguyên video và poster sẵn có.
- Kiểm chứng: đếm số dòng hiển thị dự kiến ở 3 bề ngang bằng tính toán cỡ chữ × độ dài dòng; grep xác nhận cấu trúc h1 mới; kiểm chứng trực quan nhờ user mở thử.
- Commit: "gọn tiêu đề hero còn 2 dòng và tăng kích thước khung video (issue #130)".

> **Quyết định chốt khi thực thi Bước 6 (2026-11-03):** Đo thực tế cho thấy phương án A (gộp 2 dòng, giữ nguyên chữ) không khả thi: dòng gộp dài 26 ký tự chỉ vừa cột chữ desktop khi hạ cỡ chữ xuống ~47px và vừa 390px khi hạ xuống ~30px — phá mất điểm nhấn. Đồng thời đo kiểm chứng: 3 dòng hiện tại (15/13/≤11 ký tự) **không tự gãy thêm ở bất kỳ bề ngang nào** (390/768/1440 đều vừa). Chốt: **giữ nguyên câu chữ và cơ chế xoay chữ** (câu chữ trang chủ là quyết định nội dung của leader, không tự ý viết lại trong một PR audit giao diện); mục "tối đa 2 dòng" của checklist sẽ được ghi rõ trong PR để leader xác nhận hoặc yêu cầu câu mới nếu muốn. Phần điểm nhấn vẫn thực thi: tăng kích thước khung video `.shot-main` từ 500px lên tối đa 580px (diện tích video tăng ~34%).

### Bước 7 — Văn bản bị che khuất (checklist mục 4)
- File sửa: `frontend/style.css` (chỉ khi tìm được gốc rễ trong CSS).
  - Rà soát 3 vị trí audit nêu: chữ logo "lime.", câu slogan hero, tiêu đề "Mẫu thiết kế & kịch bản" — tìm phần tử chồng lấp (position absolute/fixed, z-index, transform) trong CSS tương ứng.
  - **Lưu ý trung thực:** lỗi này audit đo bằng trình duyệt thật (CDP), phân tích tĩnh chỉ khoanh vùng được nghi phạm. Nếu tại thời điểm làm, kiểm tra trực tiếp không tái hiện được lỗi (có thể phụ thuộc trạng thái cuộn/độ phân giải), bước này dừng ở báo cáo vị trí nghi vấn + đề xuất cách kiểm chứng, ghi rõ vào PR thay vì sửa mò.
- Kiểm chứng: đối chiếu từng vị trí: xác định được phần tử che + sửa + grep diff đúng phạm vi, hoặc báo cáo không tái hiện được kèm bằng chứng.
- Commit (nếu sửa được): "sửa lỗi văn bản bị che khuất do chồng lấp bố cục (issue #130)".

> **Kết quả điều tra Bước 7 (2026-11-03) — không tái hiện được bằng phân tích tĩnh, không sửa code:** Đã rà soát cả 3 vị trí audit nêu. (1) Logo "lime.": thanh nav cố định `z-index: 60` là lớp chrome trên cùng ở trạng thái mặc định; các lớp cao hơn (z-index 9999/10000) đều là modal đang ẩn. (2) Slogan hero: lớp phủ duy nhất là `#home::before` — gradient trang trí trong suốt (alpha tối đa 0.28, `pointer-events: none`), và khối `.hero` có `position: relative` nên nội dung luôn vẽ phía trên; hộp từ xoay (`.flip-word-box`) nằm trong luồng thường, không chồng lấp. (3) Tiêu đề "Mẫu thiết kế & kịch bản": nằm trong luồng thường của section `#templates`. Cả 3 section đều đã bù chiều cao nav cố định bằng `padding-top: 76px`. Khả năng cao công cụ audit (CDP) đã tính các gradient trang trí trong suốt là "che khuất", hoặc đo trong lúc chuyển cảnh cuộn/modal đang mở. Nội dung này sẽ ghi vào mô tả PR: nhờ leader kiểm tra lại bằng công cụ audit; nếu vẫn còn, xin ảnh chụp kèm độ phân giải và trạng thái trang để xử lý tiếp thay vì sửa mò.

### Bước 8 — Giản lược pill/eyebrow + ký tự trang trí (checklist mục 7)
- File sửa: `frontend/index.html`, `frontend/style.css`.
  - Phạm vi giữ hẹp và cụ thể: liệt kê toàn bộ nhãn pill/eyebrow đang có trên trang (grep class eyebrow/pill/kicker khi thực thi), chỉ **gỡ những nhãn trùng lặp ý với tiêu đề ngay dưới nó** hoặc nhãn trang trí thuần túy không mang thông tin; giữ lại tối đa 1 eyebrow cho mỗi section chính.
  - Ký tự trang trí: dấu ✓ trong `.feats li::before` (đang là content chữ trong CSS) đổi sang dấu tick vẽ bằng CSS thuần (border xoay 45°) cho đồng bộ; ký tự ✦ trong các eyebrow còn giữ lại thì bỏ, giữ phần chữ. Emoji trong nội dung chữ (nếu có) rà soát theo danh sách grep khi thực thi.
  - Không thiết kế lại section nào ở bước này — chỉ gỡ bớt và thống nhất ký hiệu.
- Kiểm chứng: đếm lại số eyebrow/pill trước/sau; grep `✓`/`✦` trong phạm vi đã xử lý; diff đúng phạm vi.
- Commit: "giản lược nhãn pill/eyebrow thừa và thống nhất ký hiệu đánh dấu (issue #130)".

### Bước 9 — Đổ bóng + hiệu ứng CTA (checklist mục 8)
- File sửa: `frontend/style.css`.
  - Lập danh sách các `box-shadow` nặng trên **phần tử tĩnh** (khung promptbar, `.shot-main`, card thường...) từ census 51 khai báo: giảm về mức bóng nhẹ thống nhất (một mức duy nhất cho card tĩnh). **Giữ nguyên** bóng của phần tử nổi thật sự (modal, dropdown, `.plan.hot` là card điểm nhấn có chủ đích) — ghi rõ danh sách giữ lại trong báo cáo bước.
  - Nút `.shimmer-btn`: bỏ lớp `.shimmer-glow` + animation xoay (`shimmer-spin`), chuyển nút CTA về dạng tĩnh dùng màu `--lime-deep`/nền đặc như các nút chính khác. (Chỉ sửa CSS; phần tử span trong HTML giữ nguyên nhưng không còn hiệu ứng — hoặc gỡ span nếu user đồng ý đụng thêm index.html ở bước này.)
- Kiểm chứng: census box-shadow trước/sau (số khai báo nặng giảm, còn lại là phần tử nổi); grep `shimmer` không còn animation áp lên nút CTA; diff đúng phạm vi.
- Commit: "làm phẳng đổ bóng phần tử tĩnh và bỏ hiệu ứng shimmer ở nút CTA (issue #130)".

### Bước 10 — Ảnh/video thật (checklist mục 9) — CHỜ ASSET
- Điều kiện làm: có sẵn file ảnh/video mẫu do chính LIME tạo (ví dụ video mẫu từ thư viện/template của sản phẩm) để đưa lên trang.
- Nếu có asset: thêm một section/khối preview vào `frontend/index.html` dùng đúng asset đó (video có poster như hero), style theo hệ sẵn có trong `frontend/style.css`. File nhị phân (ảnh/video) cần user commit từ máy local như tiền lệ Bước 6 issue #129 (công cụ của assistant không đẩy được file nhị phân).
- Nếu chưa có asset: bước này **dừng ở ghi nhận**, nội dung xin leader cung cấp asset hoặc xác nhận hoãn sẽ nằm trong comment Bước 0 và trong mô tả PR — không tự chế ảnh giả để lấp checklist.
- Commit (nếu làm được): "bổ sung preview video mẫu thật của LIME lên trang chủ (issue #130)".

> **Kết quả Bước 10 (2026-11-03) — đóng ở dạng chờ asset, không sửa code:** Đã rà soát toàn repo: media thật duy nhất trên trang hiện là video hero (`hero.webm`/`hero.mp4` + poster). Có đúng 2 file ứng viên là `public/video_1.mp4` (2,9MB) và `public/video_2.mp4` (1,4MB), nhưng không dùng được ngay vì: (1) chưa xác nhận chắc chắn chúng là video mẫu phù hợp để đưa lên trang chủ; (2) thư mục `public/` không được server phục vụ — cấu hình static chỉ đăng ký thư mục `frontend/` — muốn dùng phải chuyển 2 file vào `frontend/` bằng commit từ máy local như tiền lệ poster của issue #129. Chốt: checklist mục 9 sẽ ghi trong mô tả PR ở dạng **chờ asset/xác nhận của leader** (xin cung cấp video mẫu chính thức, hoặc xác nhận dùng 2 file trên thì làm tiếp ngay) — không tự chế asset giả để lấp checklist. (Lưu ý: bản kế hoạch có nhắc "comment Bước 0", nhưng với issue này user đã chốt không đăng comment lên issue — nội dung chỉ nằm trong mô tả PR.)

### Bước cuối — Rà soát + PR
- Chạy census tổng: đếm lại số cỡ font, đo lại các cặp tương phản đã sửa, kiểm tra cân bằng ngoặc CSS, rà soát diff toàn nhánh.
- Tự review bằng skill `review-code`, mở PR vào `main`: mô tả đối chiếu đủ 9 mục checklist (mục nào làm kèm commit; các điểm loại trừ/chờ asset ghi rõ lý do), kèm lưu ý còn nợ kiểm chứng trực quan ở 390/768/1440px.

---

## 4. Các quyết định cần chốt khi duyệt bản phân tích này

1. **Tiêu đề hero:** Phương án A (khuyến nghị) — gộp còn 2 dòng "Chữ thành phim." / "Ý tưởng thành + từ xoay", giữ nguyên từ ngữ và cơ chế xoay chữ. Phương án B — giữ nguyên 3 dòng như thiết kế hiện tại, chỉ chống gãy dòng ngoài ý muốn: cách này không đạt đúng chữ checklist ("tối đa 2 dòng"), phải xin leader xác nhận riêng.
2. **Thang typography (cho Bước 3–4):** chốt 5 cấp cho chữ nội dung — Display (cỡ clamp của h1/h2), Heading (20–24px), Lead (18px), Body **16px**, Small/Caption **13–14px** — kèm sàn 11px cho nhãn chức năng trong khung mockup (điểm loại trừ có chủ đích). Nếu muốn ép đúng checklist 100% (mọi chữ ≥ 13px) thì báo trước: rủi ro vỡ bố cục các khung giả lập terminal/browser là có thật.
3. **Mục ảnh/video thật (Bước 10):** mặc định xử lý theo hướng "chờ asset" như trên — nếu user có sẵn file video mẫu của LIME thì đưa vào làm luôn trong đợt này.
