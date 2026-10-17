# Issue #40: CDP BeginFrame Capture & Static Frame Deduplication

## 1. Vấn đề

Pipeline render hiện tại (`src/pipeline/renderer.ts`) có 2 nhược điểm:

1. **Lãng phí render frame tĩnh:** Video explainer/motion text có nhiều đoạn 1-3s đứng yên (30-90 frame giống hệt). Hệ thống vẫn chụp lại từng frame qua `page.screenshot()`, lãng phí CPU.

2. **Overhead của `page.screenshot()`:** Phải qua nhiều tầng Playwright, không đồng bộ với chu kỳ composite của Chromium, có thể gây frame flicker.

**Hiện trạng:** Đã có `detectMotion()` + skip logic (`if (!motion.hasMotion)`) trong Spec D. Nhưng motion detection chạy bằng JS trong page (tốn thời gian), và vẫn phải screenshot 1 lần cho frame tĩnh.

## 2. Tài liệu liên quan

- **heygen-com/hyperframes** (`packages/engine/src/services/frameCapture.ts`): CDP `HeadlessExperimental.beginFrame` + `hasDamage` flag + static frame dedup. Giảm 30-50% thời gian render cho explainer/slideshow.
- **Chrome DevTools Protocol:** `HeadlessExperimental.beginFrame` với `frameTimeTicks` và `screenshot` options.
- **Code hiện tại:**
  - `src/pipeline/renderer.ts`: vòng lặp render frame, `detectMotion()` từ `./motion.js`
  - `src/pipeline/motion.js`: motion detection bằng JS
  - `src/pipeline/preview.ts`: `launchPreviewBrowser()` — nơi thêm Chromium flags

## 3. Thiết kế

### 3.1. CDP BeginFrame Capture

Thay `page.screenshot()` bằng CDP session:

```typescript
const client = await page.context().newCDPSession(page);
const result = await client.send(HeadlessExperimental.beginFrame, {
    frameTimeTicks: ...,
    screenshot: { format: jpeg, quality: 90 }
});
// result.hasDamage: boolean — true nếu có thay đổi thị giác
// result.screenshotData: base64 — chỉ có khi hasDamage=true
```

**Chromium flags** (thêm vào `launchPreviewBrowser`):
- `--enable-begin-frame-control`
- `--deterministic-mode` (đã có? kiểm tra)
- `--run-all-compositor-stages-before-draw`

### 3.2. Static Frame Deduplication

```
for each frame:
    beginFrame() → { hasDamage, screenshotData }
    if (!hasDamage && lastFrameBuffer):
        # Không có thay đổi → tái sử dụng buffer cũ, KHÔNG decode lại
        frameToPipe = lastFrameBuffer
    else:
        frameToPipe = decode(screenshotData)
        lastFrameBuffer = frameToPipe
```

**Lưu ý:** Khi bật Spec D shutter blur, vẫn cần motion detection chi tiết. CDP `hasDamage` chỉ là boolean (có/không), không cho biết mức độ chuyển động. Vì vậy:
- Nếu `skipShutterBlur=true`: dùng CDP hasDamage để skip hoàn toàn
- Nếu shutter blur bật: vẫn dùng `detectMotion()` hiện tại (đã tối ưu)

### 3.3. Pre-flight Readiness Gate

Đã có `document.fonts.ready` chờ. Bổ sung:
- Inject CSS ẩn các element chưa đến thời điểm xuất hiện (chống FOUC ở frame 0)

## 4. Kế hoạch test

1. **Unit test:** Mock CDP session, verify logic dedup (hasDamage=false → reuse buffer, không gọi decode)
2. **Integration test:** Render video 10s có đoạn tĩnh 3s, đo thời gian render giảm
3. **Regression test:** So sánh output video (frame-by-frame hash) giữa CDP và screenshot cũ — phải giống hệt
4. **Test với shutter blur:** Đảm bảo Spec D vẫn hoạt động đúng

## 5. Tiêu chí nghiệm thu

- [ ] CDP BeginFrame thay thế `page.screenshot()` trong đường render chính
- [ ] Static frame dedup: frame tĩnh không decode lại, tái sử dụng buffer
- [ ] Video output giống hệt bản cũ (hash frame khớp)
- [ ] Thời gian render giảm ≥20% cho video có đoạn tĩnh
- [ ] Spec D shutter blur không bị ảnh hưởng
- [ ] `npm test` xanh
