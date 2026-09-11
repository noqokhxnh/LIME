1: [v]docker 
redis(core)
2: [v]retry phase error
3: []Authentication: google
4: []rate limit: giới hạn số job đồng thời per user, số request per minute, tránh quá tải và lạm dụng chi phí LLM/TTS.
5: []prompt injection
6: []edit per-frame text inline 

[]Auto subtitles
[]History video

7: []token counting
[]token per user 
[]Thanh toán: vietqr api
[]dashboard admin


[]auto switch model: for dev
[]phân tích url paper to video
[]CLI

[] kịch bản json -> ai enhance
[] plugin cho GSAP

Thiết kế các style trong src/constants/style.ts, hiện có 3 style, thêm style thì thêm vào style trong object videoRequestSchema trong schema.ts

┌─────────────────────────────────────────────────────────────┐
│ Giai đoạn 1: Thiết Kế & System Prompt (Screen vs Voice)     │
│ ├─ Viết lại system.txt (Quy chuẩn Typography, Bố cục, Tone) │
│ ├─ Hoàn thiện src/constants/style.ts (Style Presets & Fonts)│[V]
│ └─ Cập nhật prompt builder & quy chuẩn Visual Anchor        │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ Giai đoạn 2: GSAP Motion Engine & Presets Toolkit            │
│ ├─ Xây dựng window.__motion helpers trong assembleHtml.ts   │
│ ├─ Tích hợp Motion Blur, Mask Reveal, Counter, Kinetic Text │
│ └─ Hướng dẫn LLM áp dụng Toolkit trong Scene jsCode         │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ Giai đoạn 3: Hệ Thống Sound FX (SFX) & FFmpeg Mixing        │
│ ├─ Bổ sung soundCues vào Scene Schema                        │
│ ├─ Chuẩn bị kho SFX core (khoảng 30-40 sounds CC0)          │
│ └─ Module sfxMixer.ts tạo stem và mix với Voice + BGM       │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ Giai đoạn 4: Thư Viện Icon Vector & Kiểm Thử Toàn Diện      │
│ ├─ Helper window.__icon() hỗ trợ bộ Lucide / Tabler         │
│ └─ Benchmark so sánh chất lượng video trước / sau nâng cấp  │
└─────────────────────────────────────────────────────────────┘
