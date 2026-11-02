---
name: lime-ui-craft
description: "Kỹ năng thiết kế UI/UX độc quyền cho LIME (Lightweight Intelligent Motion Engine). Kế thừa triết lý Anti-AI Slop từ hallmark và art direction biên tập từ design-taste-frontend. Chuẩn hóa kiến trúc nhịp điệu tương phản Chiaroscuro, thanh điều hướng thích ứng đa nền, hệ thống layout archetypes và bảng giá bản địa hóa tích hợp VietQR."
version: 2.1.0
---

# LIME UI Craft — Dedicated Design System & Interface Archetypes

> **Mục tiêu**: Định hình phương pháp luận thiết kế UI/UX độc quyền cho toàn bộ hệ sinh thái **LIME** (Lightweight Intelligent Motion Engine).  
> **Ngăn xếp kỹ thuật**: Vanilla HTML5, Vanilla CSS3 (Custom Design Tokens), Vanilla JS (ESM), Fastify Static Server.  
> **Nguồn gốc kế thừa**: Tổng hòa giữa **Art Direction chuyên sâu** (`design-taste-frontend`) và **Kỷ luật chống AI-slop** (`hallmark`).

---

## 1. Cơ sở lý luận & Phả hệ thiết kế (Lineage & Architectural Foundation)

Mọi giao diện thuộc hệ thống LIME không được thiết kế tùy tiện theo mẫu có sẵn (templates) hoặc sao chép vụn vặt. Giao diện được sinh ra từ **phương pháp luận tổng hợp giữa 2 skill nền tảng và 1 bản sắc riêng**:

```
┌───────────────────────────────────────┐       ┌───────────────────────────────────────┐
│         design-taste-frontend         │       │               hallmark                │
│  • Art Direction chuẩn Awwwards/Studio│       │  • Kỷ luật Anti-AI Slop khắt khe      │
│  • Bố cục biên tập (Editorial Depth)  │       │  • Cấm vẽ Chrome giả (No Fake Chrome) │
│  • Trọng chất hơn lượng (Substance)   │       │  • Khóa chặt Token, cấm Heading nghiêng│
└───────────────────┬───────────────────┘       └───────────────────┬───────────────────┘
                    │                                               │
                    └───────────────────────┬───────────────────────┘
                                            │
                                            ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                                     lime-ui-craft                                     │
│                     (Hệ kỹ năng chuyên biệt cho hệ sinh thái LIME)                     │
│                                                                                       │
│  1. Nhịp điệu tương phản luân phiên (Chiaroscuro Rhythm Pattern)                      │
│  2. Cơ chế điều hướng thích ứng bề mặt (Smart Adaptive Navbar Protocol)               │
│  3. Khung nhập liệu nổi gối đầu (Floating Interaction Hub Archetype)                  │
│  4. Trình diễn chuyển động chân thực (Authentic Media Showcase Archetype)             │
│  5. Bảng giá SaaS bản địa hóa kết hợp VietQR (Bespoke Localized Billing Archetype)    │
│  6. Chân trang pháp lý kiên cố (Obsidian Regulatory Anchor Archetype)                 │
└───────────────────────────────────────────┬───────────────────────────────────────────┘
                                            │
                                            ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                      THÀNH PHẨM ÁP DỤNG THỰC TẾ (DEMONSTRATION)                       │
│  • Giao diện Trang chủ hoàn chỉnh (Landing Page · index.html)                          │
│  • Giao diện Không gian làm việc LIME Studio (Workspace · workspace.html)             │
│  • Giao diện Trung tâm Cấu hình & Quản trị (Setting · setting.html)                   │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Hệ thống Design Tokens & Kỷ luật Kiểu chữ (Design Tokens & Typography)

### 2.1. Phân cấp Typography (Roman-only & Strict Hierarchy)
Tuân thủ kỷ luật từ `hallmark`, toàn bộ tiêu đề đều sử dụng kiểu chữ đứng (**Roman-only**, tuyệt đối cấm dùng `italic` trong Heading để tránh cảm giác AI-generated):

- **Display / H1 / H2**: `Space Grotesk` (Weight `600-700`, `letter-spacing: -0.03em`, áp dụng `text-balance`). Thể hiện tính công nghệ, hình học chính xác và sắc nét.
- **Body / Subhead / UI Control**: `Inter` (Weight `400-500`, `line-height: 1.6`, `letter-spacing: -0.01em`). Đảm bảo độ đọc tối ưu trên màn hình võng mạc (Retina).
- **Code / Metrics / Badges**: `JetBrains Mono` (Weight `400-500`, uppercase tracking rộng `0.08em - 0.12em`). Dùng cho các thẻ công nghệ, định danh token và thông số render.

### 2.2. Bảng màu tương phản sâu & Tỷ lệ tiết chế (Color System)
- **Deep Obsidian (Nền tối chủ đạo)**: `#07090E` và `#08090D`. Đại diện cho phòng chiếu điện ảnh và không gian sáng tạo chuyên sâu.
- **Clean Studio Canvas (Nền sáng tương phản)**: `#FFFFFF` và `#F8F9FA`. Tạo khoảng nghỉ thị giác, dùng cho phần tính năng biên tập và bảng giá dịch vụ.
- **Electric Lime / Citron (Màu nhấn nhận diện)**: `#B9E72B` (hoặc `#A3E635`). **Quy tắc diện tích (Surface Rule)**: Chỉ được chiếm tối đa **1% - 3%** diện tích giao diện (dùng cho huy hiệu ưu đãi, icon xác thực, điểm phát sáng viền thẻ chủ đạo).
- **Hairline Borders (Đường chỉ siêu mảnh)**: `1px solid rgba(255,255,255,0.08)` trên nền tối và `1px solid rgba(0,0,0,0.08)` trên nền sáng. Không dùng viền đậm làm thô bố cục.

---

## 3. Các mẫu kiến trúc giao diện chủ đạo (Core Layout Archetypes)

Hệ kỹ năng này định nghĩa 6 mẫu kiến trúc chuẩn hóa (Archetypes) để xây dựng bất kỳ màn hình nào trong hệ thống:

### Archetype A: Nhịp điệu tương phản Chiaroscuro (Alternating Contrast Rhythm)
- **Nguyên lý**: Không thiết kế một trang dài toàn màu đen (gây nặng nề) hoặc toàn màu trắng (thiếu tính điện ảnh).
- **Cấu trúc nhịp**: Luân chuyển nhịp điệu ánh sáng giữa các phân đoạn lớn theo chuỗi:  
  `Tối (Dark Stage)` ➔ `Sáng (Light Canvas)` ➔ `Tối (Dark Stage)` ➔ `Sáng (Light Canvas)` ➔ `Tối (Dark Anchor)`.
- **Hiệu quả**: Tạo nhịp đập trực quan (visual pacing), mỗi lần cuộn qua một phân đoạn mới là một cảm giác tươi mới, thôi thúc người dùng khám phá tiếp.

### Archetype B: Thanh điều hướng thích ứng đa nền (Smart Adaptive Navbar)
- **Cơ chế hòa trộn màu**: Cố định trên cùng (`fixed top-0 z-50`), áp dụng CSS `mix-blend-difference` để chữ và logo tự động tương phản với màu nền phía sau (chữ tự chuyển trắng trên nền đen, chuyển đen trên nền trắng).
- **Observer đa vùng**: Sử dụng `IntersectionObserver` giám sát thuộc tính `data-nav-theme="dark|light"` tại từng phân đoạn để cập nhật đường viền chỉ đáy (`#nav-bottom-border`).
- **Phản xạ cuộn thông minh**: Tự động trượt lên ẩn đi khi người dùng cuộn xem nội dung xuống dưới, và ngay lập tức trượt xuống hiển thị khi người dùng khẽ cuộn ngược lên trên.
- **Hành vi Auth Modal**: Đăng nhập/Đăng ký mở modal tại chỗ. Khi hoàn tất xác thực, giao diện **cuộn ngay về vị trí trên cùng (`window.scrollTo({ top: 0, behavior: 'instant' })`)** và cập nhật menu người dùng.

### Archetype C: Khung nhập liệu nổi gối đầu (Floating Interaction Hub)
- **Vị trí**: Đặt gối đầu ngay giữa đường ranh giới của phân đoạn tối (Hero) và phân đoạn sáng (Features), sử dụng khoảng phủ âm (`negative margin`).
- **Cấu trúc 2 lớp**:
  - *Lớp vỏ ngoài*: Kính mờ cao cấp (`backdrop-blur-xl`, nền gradient mờ `from-white/10 to-white/5`, bo góc lớn `rounded-2xl` hoặc `rounded-3xl`).
  - *Lớp lõi thao tác*: Thẻ nhập liệu trắng tuyết phẳng tương phản cao, chứa textarea không viền, nút hành động tròn và hàng nút gợi ý nhanh (Suggestion Pills).
- **Cầu nối dữ liệu (Data Bridge)**: Dữ liệu nhập vào ô tương tác được đóng gói và chuyển giao liền mạch vào không gian làm việc Studio.

### Archetype D: Trình diễn chuyển động chân thực (Authentic Media Showcase)
- **Kỷ luật Anti-Slop**: Tuyệt đối không đóng khung ảnh sản phẩm vào cửa sổ macOS giả mạo (No Fake Chrome).
- **Tỉ lệ khung hình chuẩn**: Hỗ trợ đồng thời tỉ lệ ngang điện ảnh `16:9` và tỉ lệ dọc di động `9:16`.
- **Vi mô tương tác**: Khi người dùng lướt chuột qua thẻ, khung media chỉ phóng nhẹ `scale-[1.02]` với đường cong gia tốc mượt mà (`ease-out 300ms`). Mỗi thẻ mẫu đều kèm theo nhãn phân loại, đoạn trích kịch bản prompt thực tế và nút kích hoạt mẫu nhanh.

### Archetype E: Bảng giá SaaS bản địa hóa kết hợp VietQR (Bespoke Localized Billing)
- **Bộ chuyển kỳ thanh toán (Bifurcated Billing Toggle)**: Nút gạt chuyển đổi linh hoạt giữa *Theo tháng* và *Theo năm*, đính kèm huy hiệu chiết khấu màu Electric Lime (`#B9E72B`).
- **Phân cấp 3+1 (Tier Hierarchy)**:
  - *Thẻ Tiêu chuẩn (Free/Starter)*: Nền sáng tối giản, nút viền thanh thoát.
  - *Thẻ Tiêu điểm (Pro Spotlight)*: Tâm điểm thị giác của bảng giá, viền phát sáng gradient thanh lịch ôm sát thẻ (không tràn viền), huy hiệu nổi bật, tích hợp nút gọi thanh toán VietQR tự động.
  - *Thẻ Nâng cao (Max Monolith)*: Đậm chất chuyên nghiệp cho studio/agency.
  - *Thẻ Doanh nghiệp độc lập (Enterprise Monolith)*: Thiết kế dạng thẻ ngang (Full-width) đặt riêng biệt, sử dụng nền kính đen than sang trọng (`Dark Glass`), làm nổi bật tính năng đa thành viên và hạ tầng API mà không bị lu mờ trước các gói bán lẻ.
- **Ma trận so sánh mở rộng (Expandable Feature Matrix)**: Mặc định thu gọn dưới dạng nút bấm bo tròn tinh tế; khi mở ra hiển thị bảng đối chiếu chi tiết toàn bộ thông số kỹ thuật.

### Archetype F: Chân trang pháp lý kiên cố (Obsidian Regulatory Anchor)
- **Tông màu**: Dark Obsidian `#07090E` tạo điểm kết vững chắc cho toàn bộ trang.
- **Hệ thống điều hướng 3 cột**: Pháp lý & Quy định (Điều khoản, Bảo mật, Trung tâm pháp lý, Hoàn tiền, Bản quyền AI) · Hệ sinh thái sản phẩm · Kênh hỗ trợ & Mạng xã hội.
- **Modal pháp lý tại chỗ**: Tích hợp nút bấm mở nhanh tài liệu pháp lý trực tiếp trong cửa sổ tương tác mà không cần tải lại trang.
- **Bảo chứng an ninh (Trust Marks)**: Huy hiệu trạng thái máy chủ hoạt động thời gian thực (`Status: Operational 24/7`), chứng nhận mã hóa AES-256 và cổng thanh toán Napas 24/7.

---

## 4. Minh họa áp dụng: Kiến trúc Trang chủ LIME (Reference Implementation)

Để chứng minh tính hiệu quả của hệ kỹ năng, giao diện **Trang chủ LIME (`index.html`)** được kiến tạo bằng cách tổng hợp chuẩn xác 6 Archetypes trên thành một dòng chảy trải nghiệm hoàn chỉnh:

| Phân đoạn trên Trang chủ | Archetype tương ứng | Đặc điểm triển khai cụ thể |
| :--- | :--- | :--- |
| **1. Hero Section** (Tối) | Archetype A + B + C | Video nền điện ảnh phủ tối 0.35 + Khung nhập Prompt gối đầu `-mt-40` + Gợi ý kịch bản mẫu nhanh |
| **2. Tính năng & Sứ mệnh** (Sáng) | Archetype A + Editorial Depth | Pill cấu hình nổi dẫn tới `/setting` + Tuyên ngôn sứ mệnh Display lớn + Dải Marquee công nghệ vô tận + Trình diễn LIME Studio |
| **3. Mẫu kịch bản & Giao diện** (Tối) | Archetype A + D | Lưới 4 Playlist mẫu thực tế (SaaS 16:9, Flash Sale 9:16, Bài giảng, Kiến trúc) + Nút nạp mẫu `stashPrompt()` |
| **4. Bảng giá dịch vụ** (Sáng) | Archetype A + E | Nền `#F8F9FA` + Toggle Tháng/Năm (-20%) + 3 Thẻ bán lẻ + Thẻ ngang Enterprise Dark Glass + Ma trận so sánh 28+ mục |
| **5. Chân trang pháp lý** (Tối) | Archetype A + F | Nền `#07090E` + Cột Điều khoản/Bảo mật mở modal tại chỗ + Trạng thái hệ thống 24/7 + Huy hiệu AES-256 & VietQR |

---

## 5. Quy tắc mở rộng cho các phân hệ tiếp theo (Extensibility Protocol)

Khi dùng kỹ năng này để thiết kế hoặc nâng cấp các trang tiếp theo trong hệ sinh thái LIME, hãy tuân thủ ánh xạ:

1. **Phân hệ Không gian làm việc (`workspace.html`)**:
   - Sử dụng tông nền **Dark Stage (`#08090D`)** toàn diện để người dùng tập trung vào timeline và khung canvas video.
   - Các bảng điều khiển (Inspector, Timeline, Storyboard) áp dụng cấu trúc Slate Glass với viền hairline `1px solid rgba(255,255,255,0.08)`.
   - Các nút kích hoạt render hoặc xuất bản mang màu nhấn Electric Lime (`#B9E72B`).
2. **Phân hệ Cấu hình & Quản trị (`setting.html` / `admin.html`)**:
   - Áp dụng cấu trúc **Clean Studio Canvas (`#F8F9FA` hoặc `#FFFFFF`)** kết hợp sidebar điều hướng tối giản để tạo không gian thoáng đãng khi quản lý danh sách dài.
3. **Phân hệ Tài liệu Pháp lý (`legal.html`)**:
   - Kế thừa cấu trúc Typography biên tập từ `design-taste-frontend`: Cột chữ rộng chuẩn typographic (`max-w-3xl`), mục lục bám dính (sticky TOC), và thanh điều hướng thích ứng.

---

## 6. Danh mục kiểm định chất lượng (Pre-Flight Verification Checklist)

Mọi bản dựng hoặc cập nhật giao diện phải vượt qua 7 cổng kiểm định trước khi hoàn tất:

- [ ] **Tính nhất quán Typography**: 100% tiêu đề sử dụng `Space Grotesk` dạng đứng (`font-style: normal`), không có từ in nghiêng lạc lõng; nội dung dùng `Inter`.
- [ ] **Kỷ luật Anti-Slop**: Không có hiệu ứng hạt phát sáng vô nghĩa (particles), không có viền cửa sổ trình duyệt 3 chấm giả tạo (no fake chrome).
- [ ] **Tỷ lệ màu nhấn**: Màu Electric Lime (`#B9E72B`) chỉ xuất hiện ở các điểm nhấn chiến lược (CTA chính, badge chiết khấu, icon kiểm tra), không lạm dụng làm loãng nhận diện.
- [ ] **Kiểm tra độ tương phản**: Toàn bộ chữ và nền đạt chuẩn WCAG 2.2 AA về khả năng đọc rõ ràng.
- [ ] **Điều hướng thông minh**: Thanh điều hướng tự động chuyển đổi tương phản hoàn hảo khi cuộn qua các phân đoạn tối/sáng.
- [ ] **Toàn vẹn tương tác**: Các hook liên kết chức năng (Auth modal, prompt stash, payment trigger, legal modal) hoạt động chính xác không gây lỗi console.
- [ ] **Đáp ứng đa thiết bị (Responsive Floor)**: Kiểm tra trực quan tại 375px (Mobile), 768px (Tablet) và 1440px (Desktop), đảm bảo không tràn ngang (`overflow-x: clip`).
