# Issue #36: Interactive In-Browser GSAP Live Preview Player

## 1. Vấn đề

Người dùng hiện chỉ có 2 cách xem thử:
1. Thumbnail tĩnh WebP (midpoint của mỗi scene)
2. Mở HTML trong tab mới (nút "Xem bản HTML")

Không có cách nào để:
- Xem chuyển động mượt mà với điều khiển playback
- Tua timeline (scrubbing) để kiểm tra từng thời điểm
- Đồng bộ âm thanh TTS với hình ảnh
- Kiểm tra nhịp điệu trước khi render MP4 (tốn thời gian)

## 2. Tài liệu liên quan

- **remotion-dev/remotion** (`@remotion/player`): In-browser video player với scrubbing, playback controls, A/V sync
- **Code hiện tại:**
  - `frontend/workspace.html`: có nút "Xem bản HTML" mở tab mới
  - `src/pipeline/assembleHtml.ts`: tạo HTML với `window.__seekTo(time)`, `window.__ready`
  - `src/pipeline/preview.ts`: backend preview (screenshot)

## 3. Thiết kế

### 3.1. Kiến trúc

```
┌─────────────────────────────────────────┐
│ Preview Player (frontend/js/preview-player.js) │
├─────────────────────────────────────────┤
│ ┌─────────────┐  ┌──────────────────┐    │
│ │   Iframe    │  │    Controls      │    │
│ │ (GSAP HTML) │  │ Play/Pause       │    │
│ │             │  │ Scrubber slider  │    │
│ │             │  │ Scene nav        │    │
│ │             │  │ Time display     │    │
│ └─────────────┘  └──────────────────┘    │
│ ┌─────────────────────────────────────┐  │
│ │ Audio element (TTS mp3)             │  │
│ └─────────────────────────────────────┘  │
└─────────────────────────────────────────┘
         ↕ postMessage / direct access
┌─────────────────────────────────────────┐
│ GSAP HTML (iframe)                      │
│ - window.__seekTo(t)                    │
│ - window.__ready                        │
│ - window.__duration                     │
└─────────────────────────────────────────┘
```

### 3.2. API giao tiếp với iframe

```javascript
// Trong iframe (đã có từ assembleHtml.ts)
window.__seekTo(timeSec);  // Di chuyển timeline đến thời điểm
window.__ready;            // true khi GSAP sẵn sàng
window.__duration;         // Tổng thời lượng (giây)

// Từ parent (preview player)
const iframe = document.getElementById(preview-iframe);
const iframeWin = iframe.contentWindow;
iframeWin.__seekTo(5.2);  // Seek đến 5.2s
```

### 3.3. Tính năng

1. **Playback controls:**
   - Play/Pause: điều khiển GSAP timeline + audio đồng bộ
   - Scrubber: slider kéo để seek tức thời
   - Scene prev/next: nhảy đến đầu scene trước/sau
   - Time display: `00:05 / 00:30`

2. **Audio sync:**
   - `<audio>` element với TTS mp3
   - Khi play: `audio.play()` + GSAP play
   - Khi pause: cả hai pause
   - Khi seek: `audio.currentTime = t` + `__seekTo(t)`

3. **Tích hợp:**
   - Nút "Xem thử chuyển động" trong tab Kịch bản
   - Modal hoặc panel hiển thị player
   - Load HTML từ `/api/jobs/:id/preview-html` (cần backend endpoint)

### 3.4. Backend cần thiết

- `GET /api/jobs/:id/preview-html`: trả về HTML đã assemble
- `GET /api/jobs/:id/audio`: trả về file audio TTS (đã có?)

## 4. Kế hoạch test

1. **Manual test:** Tạo job, mở preview player, kiểm tra:
   - Play/pause đồng bộ audio + hình
   - Scrubber seek mượt mà
   - Scene navigation chính xác
2. **Cross-browser:** Chrome, Firefox
3. **Mobile:** Responsive trên màn hình nhỏ

## 5. Tiêu chí nghiệm thu

- [ ] Iframe load HTML và `__seekTo` hoạt động
- [ ] Play/pause đồng bộ audio + GSAP
- [ ] Scrubber seek tức thời (<100ms)
- [ ] Scene prev/next nhảy đúng
- [ ] Time display chính xác
- [ ] Nút "Xem thử" xuất hiện sau Phase 2
- [ ] Không lỗi console
