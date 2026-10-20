# Issue #109: Shim thuộc tính hình học SVG — LLM set trực tiếp x1/y2/d… làm crash render

## 1. Vấn đề

Job thật `524ed0e1` ("vì sao các nền văn minh… đại hồng thủy") fail ở render:

```
page.evaluate: TypeError: Cannot set property y2 of #<SVGLineElement> which has only a getter
    at PropTween._setterPlain (gsap.min.js) … Timeline.seek
```

Chuỗi nguyên nhân: LLM viết tween GSAP set **trực tiếp** thuộc tính hình học của phần tử SVG (`line.y2`, `circle.cx`, `path.d`…) thay vì qua `attr: {}`; Chromium expose các thuộc tính này **chỉ-getter** → setter ném TypeError ngay trong vòng `Timeline.seek()` của contract renderer → exception thoát ra `page.evaluate` → **cả job fail**, một animation nhỏ phá vỡ cả video. Đây là lỗi thuộc "hạng LLM viết code sai — pipeline phải sống chết được với nó", không sửa được bằng prompt (LLM vẫn có thể vi phạm).

## 2. Tài liệu liên quan

- `src/pipeline/assembleHtml.ts` — nơi ghép HTML runtime; điểm tiêm shim trước `jsCode` của scene.
- `src/pipeline/renderer.ts` — contract `page.evaluate` seek per-frame (nơi hứng crash).
- `src/llm/system.txt` — giới hạn prompt (không thể bảo đảm 100%).
- Job `524ed0e1…` — evidence (topic đại hồng thủy, error `SVGLineElement y2`).

## 3. Thiết kế

**Normalizing shim tại layer đóng gói HTML** — một chỗ sửa nhỏ, chữa triệt để cho MỌI mã jsCode hiện tại lẫn tương lai, không cần đợi LLM "học" rule:

1. Export `SVG_ATTR_SHIM_JS` (IIFE `svgAttrShim()`): với mỗi prototype SVG phổ biến (`SVGLineElement`, `SVGRectElement`, `SVGCircleElement`, `SVGEllipseElement`, `SVGPolyline/PolygonElement`, `SVGPathElement`, gradient linear/radial) và danh sách thuộc tính hình học (`x1,y1,x2,y2,x,y,width,height,rx,ry,cx,cy,r,points,d`):
   - Nếu descriptor đã có **setter** (trình duyệt SVG2 mới đã reflection đầy đủ) → bỏ qua, không đè.
   - Ngược lại `defineProperty`: giữ nguyên getter (nếu có), setter mới gọi `setAttribute(attr, v)` — chính là ngữ nghĩa tween mà LLM cần.
   - Bọc try/catch: shim tuyệt đối không được tự làm hỏng render.
2. Tiêm vào template **ngay sau phần đăng ký plugin GSAP, TRƯỚC khối "Scene Timeline Executions"** nơi mọi jsCode của scene bắt đầu tween → mọi thao tác `.y2 = v` trở thành reflection hợp lệ.
3. Nhận mạnh: preview (`src/pipeline/preview.ts`) và Oracle QA sampler cũng tái sử dụng `assembleHtml` → hưởng lợi cùng lúc, hành vi preview khớp render.

## 4. Kế hoạch test

- `tests/unit/assembler.test.ts` — `TC-ASM-008`: HTML phải chứa IIFE `svgAttrShim()`; shim xử lý rect/path; **trật tự**: shim nằm trước marker `// Scene Timeline Executions`.
- Regression: `npm run test:unit` nguyên bộ (732 case) + `tsc --noEmit` sạch.
- Kiểu thật: chạy lại job `524ed0e1` sau khi worker nạp code mới — render phải vượt qua chỗ tween `y2` (xác nhận qua flow admin của user).

## 5. Tiêu chí nghiệm thu

- [x] HTML đóng gói luôn chứa shim trước jsCode của scene; descriptor có setter sẵn thì shim không đè.
- [x] LLM set trực tiếp `line.y2/circle.cx/path.d/…` không còn crash timeline ⇒ job không fail vì lỗi getter-only.
- [x] Unit test FAST + nguyên bộ pass từng commit.
- [x] Job fail thực tế có thể chạy lại thành công từ admin (nút "Chạy lại").
