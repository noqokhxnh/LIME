# Issue #31: Advanced Kinetic Typography & Screen FX Presets

## 1. Vấn đề

Video AI sinh ra hiện có bố cục dạng slide/thẻ phẳng, thiếu biến hóa. Cần bộ preset chuyển động chữ nghệ thuật (kinetic typography) và hiệu ứng màn hình phong cách motion graphics.

## 2. Tài liệu liên quan

- **852wa/JIZURA**: Công cụ Kinetic Typography & Lyric Motion PV tự động
  - `src/06_layouts.js`, `src/05_anim.js`: layouts và animations
  - `src/11p_*.js`: presets cho phong cách cụ thể
- **Code hiện tại:**
  - `src/constants/motionTokens.ts`: Motion tokens (Spec A)
  - `src/pipeline/assembleHtml.ts`: nơi inject `window.__motionPresets`

## 3. Thiết kế

### 3.1. Kiến trúc

Tạo `window.__motionPresets` object chứa các hàm preset:

```javascript
window.__motionPresets = {
    // Layouts
    marquee: (element, options) => {...},
    diagonalBanner: (element, options) => {...},
    stickerLabel: (element, options) => {...},
    stackGhost: (element, options) => {...},
    
    // Entrances/Exits
    explodeAssemble: (element, options) => {...},
    domino: (element, options) => {...},
    sliceGlitch: (element, options) => {...},
    crtTurnOn: (element, options) => {...},
    
    // Screen FX
    rgbSplit: (element, options) => {...},
    filmGrain: (element, options) => {...},
    paperTexture: (element, options) => {...},
};
```

### 3.2. Yêu cầu Deterministic

Mọi preset PHẢI hoạt động với `window.__seekTo(time)`:
- Không dùng `setTimeout`/`setInterval` cho animation chính
- Dùng GSAP timeline với thời gian tuyệt đối
- Mọi random phải dùng seeded PRNG (Spec B)

### 3.3. Tích hợp LLM

Cập nhật `src/llm/system.txt`:
- Liệt kê các preset có sẵn
- Ví dụ cách gọi trong `jsCode`
- Quy tắc khi nào dùng preset nào

## 4. Kế hoạch test

1. **Unit test:** Mỗi preset tạo đúng DOM structure và GSAP timeline
2. **Deterministic test:** Gọi `__seekTo(t)` nhiều lần, screenshot phải giống hệt
3. **Integration:** Render video 10s dùng các preset, kiểm tra không drop frame

## 5. Tiêu chí nghiệm thu

- [ ] 11 presets hoạt động (4 layouts + 4 entrances + 3 FX)
- [ ] Deterministic với `__seekTo`
- [ ] LLM có thể gọi qua `jsCode`
- [ ] Render MP4 không drop frame
- [ ] `npm test` xanh
