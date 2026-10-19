# Credits & Attribution

Các visual style prompts trong thư mục này được port từ dự án mã nguồn mở:
- **Repository**: [lemomo-ai/lemo-opuscar](https://github.com/lemomo-ai/lemo-opuscar)
- **Tác giả**: lemomo-ai
- **Giấy phép**: MIT License

## Giấy phép nguồn (MIT License)

Copyright (c) 2024 lemomo-ai

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Phạm vi port sang LIME

- **Được tích hợp**: 51 file tài liệu visual style prompt (`STYLE.md` -> `presets/<slug>.md`) và metadata danh mục (`style.json` -> `index.json`) nhằm phục vụ việc tạo ngữ cảnh phong cách (visual style system prompts) cho LLM kịch bản video.
- **Không tích hợp**: Toàn bộ mã nguồn demo film (`film.js`, `engine.js`, ...) và tài nguyên media demo trong kho lưu trữ gốc KHÔNG được copy sang LIME nhằm giữ trọn vẹn kiến trúc dựng hình và render GSAP/HTML thuần của LIME.
